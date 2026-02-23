// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProtocolAdapter, MarketQuote} from "../interfaces/IProtocolAdapter.sol";
import {IConditionalTokens} from "../interfaces/IConditionalTokens.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @title ProbableAdapter
/// @notice Adapter for Probable — a CLOB-based prediction market on BNB Chain using
/// Gnosis CTF (Conditional Tokens Framework) for outcome token minting/merging/redemption.
///
/// Architecture:
/// - Uses Gnosis CTF for outcome token lifecycle (split, merge, redeem)
/// - Prices are set off-chain by the owner/keeper from the CLOB API via `setQuote`
/// - Uses USDT as collateral
/// - Uses UMA Optimistic Oracle — resolution is detected via CTF payoutDenominator > 0
contract ProbableAdapter is IProtocolAdapter, Ownable2Step, IERC1155Receiver, ERC165 {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateral;
    IConditionalTokens public immutable ctf;

    // Access control: only approved callers (vault) can trade
    mapping(address => bool) public approvedCallers;

    struct MarketConfig {
        bytes32 conditionId;
        uint256 yesPositionId;
        uint256 noPositionId;
        bool registered;
        bool redeemed;
    }

    mapping(bytes32 => MarketConfig) public markets;

    // Stored quotes (set off-chain by owner/keeper from CLOB API)
    mapping(bytes32 => MarketQuote) internal quotes;

    // Adapter-level balance tracking (not per-user)
    mapping(bytes32 => uint256) public yesBalance;
    mapping(bytes32 => uint256) public noBalance;

    // Inventory of unused outcome tokens from splits (opposite side waiting to be used)
    mapping(bytes32 => uint256) public yesInventory;
    mapping(bytes32 => uint256) public noInventory;

    // Events
    event CallerAdded(address indexed caller);
    event CallerRemoved(address indexed caller);
    event MarketRegistered(bytes32 indexed marketId, bytes32 conditionId);
    event OutcomeBought(bytes32 indexed marketId, address indexed buyer, bool buyYes, uint256 amount, uint256 shares);
    event OutcomeSold(bytes32 indexed marketId, address indexed seller, bool sellYes, uint256 amount, uint256 payout);
    event Redeemed(bytes32 indexed marketId, address indexed caller, uint256 payout);
    event QuoteUpdated(bytes32 indexed marketId);

    modifier onlyApproved() {
        require(approvedCallers[msg.sender] || msg.sender == owner(), "not approved");
        _;
    }

    constructor(address _ctf, address _collateral) Ownable(msg.sender) {
        require(_ctf != address(0), "zero ctf");
        require(_collateral != address(0), "zero collateral");
        collateral = IERC20(_collateral);
        ctf = IConditionalTokens(_ctf);
    }

    // --- Access control ---

    function addCaller(address caller) external onlyOwner {
        require(caller != address(0), "zero address");
        approvedCallers[caller] = true;
        emit CallerAdded(caller);
    }

    function removeCaller(address caller) external onlyOwner {
        approvedCallers[caller] = false;
        emit CallerRemoved(caller);
    }

    // --- Market registration ---

    function registerMarket(bytes32 marketId, bytes32 conditionId) external onlyOwner {
        bytes32 yesCollectionId = ctf.getCollectionId(bytes32(0), conditionId, 1);
        bytes32 noCollectionId = ctf.getCollectionId(bytes32(0), conditionId, 2);
        uint256 yesPositionId = ctf.getPositionId(collateral, yesCollectionId);
        uint256 noPositionId = ctf.getPositionId(collateral, noCollectionId);

        markets[marketId] = MarketConfig({
            conditionId: conditionId,
            yesPositionId: yesPositionId,
            noPositionId: noPositionId,
            registered: true,
            redeemed: false
        });

        emit MarketRegistered(marketId, conditionId);
    }

    // --- Quotes ---

    function setQuote(
        bytes32 marketId,
        uint256 yesPrice,
        uint256 noPrice,
        uint256 yesLiq,
        uint256 noLiq
    ) external onlyOwner {
        quotes[marketId] = MarketQuote({
            marketId: marketId,
            yesPrice: yesPrice,
            noPrice: noPrice,
            yesLiquidity: yesLiq,
            noLiquidity: noLiq,
            resolved: isResolved(marketId)
        });
        emit QuoteUpdated(marketId);
    }

    function getQuote(bytes32 marketId) external view override returns (MarketQuote memory) {
        MarketQuote memory q = quotes[marketId];
        q.resolved = isResolved(marketId);
        return q;
    }

    // --- Trading ---

    function buyOutcome(bytes32 marketId, bool buyYes, uint256 amount) external override onlyApproved returns (uint256 shares) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(!isResolved(marketId), "market resolved");

        // Pull collateral from caller
        collateral.safeTransferFrom(msg.sender, address(this), amount);

        // Check if we have inventory of the requested side
        if (buyYes && yesInventory[marketId] >= amount) {
            yesInventory[marketId] -= amount;
            shares = amount;
        } else if (!buyYes && noInventory[marketId] >= amount) {
            noInventory[marketId] -= amount;
            shares = amount;
        } else {
            // Split collateral into both YES and NO via CTF
            collateral.forceApprove(address(ctf), amount);
            uint256[] memory partition = new uint256[](2);
            partition[0] = 1; // YES
            partition[1] = 2; // NO

            ctf.splitPosition(collateral, bytes32(0), config.conditionId, partition, amount);

            shares = amount; // 1:1 split

            // Store the unwanted side as inventory
            if (buyYes) {
                noInventory[marketId] += amount;
            } else {
                yesInventory[marketId] += amount;
            }
        }

        // Credit to adapter-level balance
        if (buyYes) {
            yesBalance[marketId] += shares;
        } else {
            noBalance[marketId] += shares;
        }

        emit OutcomeBought(marketId, msg.sender, buyYes, amount, shares);
    }

    function sellOutcome(bytes32 marketId, bool sellYes, uint256 shares) external override onlyApproved returns (uint256 payout) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(!isResolved(marketId), "market resolved");

        // Debit adapter-level balance
        if (sellYes) {
            require(yesBalance[marketId] >= shares, "insufficient balance");
            yesBalance[marketId] -= shares;
        } else {
            require(noBalance[marketId] >= shares, "insufficient balance");
            noBalance[marketId] -= shares;
        }

        // Require sufficient opposite inventory to merge
        uint256 oppositeAvailable = sellYes ? noInventory[marketId] : yesInventory[marketId];
        require(oppositeAvailable >= shares, "insufficient inventory to merge");

        // Merge YES+NO back into collateral
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1;
        partition[1] = 2;
        ctf.mergePositions(collateral, bytes32(0), config.conditionId, partition, shares);

        if (sellYes) {
            noInventory[marketId] -= shares;
        } else {
            yesInventory[marketId] -= shares;
        }

        payout = shares;
        collateral.safeTransfer(msg.sender, payout);

        emit OutcomeSold(marketId, msg.sender, sellYes, shares, payout);
    }

    function redeem(bytes32 marketId) external override onlyApproved returns (uint256 payout) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(isResolved(marketId), "not resolved");

        uint256 balBefore = collateral.balanceOf(address(this));

        if (!config.redeemed) {
            config.redeemed = true;

            // Redeem all CTF tokens for this condition
            uint256[] memory indexSets = new uint256[](2);
            indexSets[0] = 1; // YES
            indexSets[1] = 2; // NO
            ctf.redeemPositions(collateral, bytes32(0), config.conditionId, indexSets);

            // Merge any remaining paired inventory to recover collateral
            uint256 mergeable = yesInventory[marketId] < noInventory[marketId]
                ? yesInventory[marketId]
                : noInventory[marketId];
            if (mergeable > 0) {
                uint256[] memory partition = new uint256[](2);
                partition[0] = 1;
                partition[1] = 2;
                ctf.mergePositions(collateral, bytes32(0), config.conditionId, partition, mergeable);
                yesInventory[marketId] -= mergeable;
                noInventory[marketId] -= mergeable;
            }
        }

        uint256 balAfter = collateral.balanceOf(address(this));
        payout = balAfter - balBefore;

        // Send everything to caller (the vault)
        if (payout > 0) {
            collateral.safeTransfer(msg.sender, payout);
        }

        // Reset balances
        yesBalance[marketId] = 0;
        noBalance[marketId] = 0;

        emit Redeemed(marketId, msg.sender, payout);
    }

    function isResolved(bytes32 marketId) public view override returns (bool) {
        MarketConfig storage config = markets[marketId];
        if (!config.registered) return false;
        return ctf.payoutDenominator(config.conditionId) > 0;
    }

    // --- ERC1155 Receiver (required for CTF token transfers) ---

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || super.supportsInterface(interfaceId);
    }
}
