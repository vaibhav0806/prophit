// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IConditionalTokens} from "../src/interfaces/IConditionalTokens.sol";
import {PolymarketAdapter} from "../src/adapters/PolymarketAdapter.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";

contract MockConditionalTokens is IConditionalTokens {
    IERC20 public collateral;

    // conditionId => outcome index => payout numerator
    mapping(bytes32 => mapping(uint256 => uint256)) internal _payoutNumerators;
    // conditionId => payout denominator (0 = not resolved)
    mapping(bytes32 => uint256) internal _payoutDenominator;

    // positionId => owner => balance
    mapping(uint256 => mapping(address => uint256)) internal _balances;

    constructor(address _collateral) {
        collateral = IERC20(_collateral);
    }

    function splitPosition(
        IERC20 collateralToken,
        bytes32, /* parentCollectionId */
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external override {
        // Pull collateral from caller
        collateralToken.transferFrom(msg.sender, address(this), amount);

        // Credit YES and NO positions to caller
        bytes32 yesCollId = getCollectionId(bytes32(0), conditionId, partition[0]);
        bytes32 noCollId = getCollectionId(bytes32(0), conditionId, partition[1]);
        uint256 yesPos = getPositionId(collateralToken, yesCollId);
        uint256 noPos = getPositionId(collateralToken, noCollId);

        _balances[yesPos][msg.sender] += amount;
        _balances[noPos][msg.sender] += amount;
    }

    function mergePositions(
        IERC20 collateralToken,
        bytes32, /* parentCollectionId */
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external override {
        bytes32 yesCollId = getCollectionId(bytes32(0), conditionId, partition[0]);
        bytes32 noCollId = getCollectionId(bytes32(0), conditionId, partition[1]);
        uint256 yesPos = getPositionId(collateralToken, yesCollId);
        uint256 noPos = getPositionId(collateralToken, noCollId);

        require(_balances[yesPos][msg.sender] >= amount, "insufficient YES");
        require(_balances[noPos][msg.sender] >= amount, "insufficient NO");

        _balances[yesPos][msg.sender] -= amount;
        _balances[noPos][msg.sender] -= amount;

        // Return collateral
        collateralToken.transfer(msg.sender, amount);
    }

    function redeemPositions(
        IERC20 collateralToken,
        bytes32, /* parentCollectionId */
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external override {
        uint256 denom = _payoutDenominator[conditionId];
        require(denom > 0, "not resolved");

        uint256 totalPayout;
        for (uint256 i = 0; i < indexSets.length; i++) {
            bytes32 collId = getCollectionId(bytes32(0), conditionId, indexSets[i]);
            uint256 posId = getPositionId(collateralToken, collId);
            uint256 bal = _balances[posId][msg.sender];
            if (bal > 0) {
                uint256 payout = (bal * _payoutNumerators[conditionId][i]) / denom;
                totalPayout += payout;
                _balances[posId][msg.sender] = 0;
            }
        }

        if (totalPayout > 0) {
            collateralToken.transfer(msg.sender, totalPayout);
        }
    }

    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    function getCollectionId(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256 indexSet
    ) public pure override returns (bytes32) {
        return keccak256(abi.encodePacked(parentCollectionId, conditionId, indexSet));
    }

    function getPositionId(
        IERC20 collateralToken,
        bytes32 collectionId
    ) public pure override returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collateralToken, collectionId)));
    }

    function payoutNumerators(bytes32 conditionId, uint256 index) external view override returns (uint256) {
        return _payoutNumerators[conditionId][index];
    }

    function payoutDenominator(bytes32 conditionId) external view override returns (uint256) {
        return _payoutDenominator[conditionId];
    }

    function balanceOf(address owner, uint256 positionId) external view override returns (uint256) {
        return _balances[positionId][owner];
    }

    // --- Test helpers ---

    function resolve(bytes32 conditionId, bool yesWins) external {
        _payoutDenominator[conditionId] = 1;
        if (yesWins) {
            _payoutNumerators[conditionId][0] = 1; // YES wins
            _payoutNumerators[conditionId][1] = 0;
        } else {
            _payoutNumerators[conditionId][0] = 0;
            _payoutNumerators[conditionId][1] = 1; // NO wins
        }
    }
}

contract PolymarketAdapterTest is Test {
    PolymarketAdapter adapter;
    MockUSDT usdc;
    MockConditionalTokens ctf;

    address owner = address(this);
    address user = address(0xA1);

    bytes32 marketId = keccak256("POLY-MARKET-1");
    bytes32 conditionId = keccak256("CONDITION-1");

    function setUp() public {
        usdc = new MockUSDT();
        ctf = new MockConditionalTokens(address(usdc));

        adapter = new PolymarketAdapter(address(usdc), address(ctf));

        // Fund CTF with collateral so it can pay out on merges/redemptions
        usdc.mint(address(ctf), 1_000_000e6);

        // Fund user
        usdc.mint(user, 100_000e6);
    }

    function test_registerMarket() public {
        adapter.registerMarket(marketId, conditionId);

        (bytes32 storedConditionId, uint256 yesPositionId, uint256 noPositionId, bool registered) =
            adapter.markets(marketId);

        assertTrue(registered);
        assertEq(storedConditionId, conditionId);
        assertTrue(yesPositionId != 0);
        assertTrue(noPositionId != 0);
        assertTrue(yesPositionId != noPositionId);
    }

    function test_setQuote() public {
        adapter.registerMarket(marketId, conditionId);
        adapter.setQuote(marketId, 0.55e18, 0.45e18, 10_000e6, 8_000e6);

        MarketQuoteHelper.MarketQuote memory q = MarketQuoteHelper.getQuote(adapter, marketId);
        assertEq(q.yesPrice, 0.55e18);
        assertEq(q.noPrice, 0.45e18);
        assertEq(q.yesLiquidity, 10_000e6);
        assertEq(q.noLiquidity, 8_000e6);
        assertFalse(q.resolved);
    }

    function test_buyOutcome_yes() public {
        adapter.registerMarket(marketId, conditionId);

        uint256 amount = 100e6;
        vm.startPrank(user);
        usdc.approve(address(adapter), amount);
        uint256 shares = adapter.buyOutcome(marketId, true, amount);
        vm.stopPrank();

        assertEq(shares, amount); // 1:1 split
        assertEq(adapter.yesShares(marketId, user), amount);
        assertEq(adapter.noShares(marketId, user), 0);
    }

    function test_buyOutcome_no() public {
        adapter.registerMarket(marketId, conditionId);

        uint256 amount = 50e6;
        vm.startPrank(user);
        usdc.approve(address(adapter), amount);
        uint256 shares = adapter.buyOutcome(marketId, false, amount);
        vm.stopPrank();

        assertEq(shares, amount);
        assertEq(adapter.noShares(marketId, user), amount);
        assertEq(adapter.yesShares(marketId, user), 0);
    }

    function test_sellOutcome() public {
        adapter.registerMarket(marketId, conditionId);

        // Buy YES first
        uint256 amount = 100e6;
        vm.startPrank(user);
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);

        // Now sell YES — should merge with NO inventory and return collateral
        uint256 balBefore = usdc.balanceOf(user);
        uint256 payout = adapter.sellOutcome(marketId, true, amount);
        uint256 balAfter = usdc.balanceOf(user);
        vm.stopPrank();

        assertEq(payout, amount); // full merge possible since split created equal NO inventory
        assertEq(balAfter - balBefore, amount);
        assertEq(adapter.yesShares(marketId, user), 0);
    }

    function test_redeem_yesWins() public {
        adapter.registerMarket(marketId, conditionId);

        uint256 amount = 100e6;
        vm.startPrank(user);
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);
        vm.stopPrank();

        // Resolve: YES wins
        ctf.resolve(conditionId, true);

        vm.prank(user);
        uint256 payout = adapter.redeem(marketId);

        // YES wins with numerator=1, denom=1, so payout = amount * 1/1 = amount
        assertEq(payout, amount);
        assertEq(adapter.yesShares(marketId, user), 0);
        assertEq(adapter.noShares(marketId, user), 0);
    }

    function test_redeem_noWins() public {
        adapter.registerMarket(marketId, conditionId);

        uint256 amount = 100e6;
        vm.startPrank(user);
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, false, amount);
        vm.stopPrank();

        // Resolve: NO wins
        ctf.resolve(conditionId, false);

        vm.prank(user);
        uint256 payout = adapter.redeem(marketId);

        assertEq(payout, amount);
        assertEq(adapter.yesShares(marketId, user), 0);
        assertEq(adapter.noShares(marketId, user), 0);
    }

    function test_isResolved() public {
        adapter.registerMarket(marketId, conditionId);

        assertFalse(adapter.isResolved(marketId));

        ctf.resolve(conditionId, true);

        assertTrue(adapter.isResolved(marketId));
    }

    function test_onlyOwner() public {
        vm.startPrank(user);

        vm.expectRevert("not owner");
        adapter.registerMarket(marketId, conditionId);

        vm.expectRevert("not owner");
        adapter.setQuote(marketId, 0.55e18, 0.45e18, 10_000e6, 8_000e6);

        vm.stopPrank();
    }
}

// Helper to avoid import issues with the MarketQuote struct
library MarketQuoteHelper {
    struct MarketQuote {
        bytes32 marketId;
        uint256 yesPrice;
        uint256 noPrice;
        uint256 yesLiquidity;
        uint256 noLiquidity;
        bool resolved;
    }

    function getQuote(PolymarketAdapter adapter, bytes32 marketId) internal view returns (MarketQuote memory q) {
        // Call getQuote and decode into our local struct
        (bytes32 mid, uint256 yp, uint256 np, uint256 yl, uint256 nl, bool res) =
            abi.decode(abi.encode(adapter.getQuote(marketId)), (bytes32, uint256, uint256, uint256, uint256, bool));
        q = MarketQuote(mid, yp, np, yl, nl, res);
    }
}
