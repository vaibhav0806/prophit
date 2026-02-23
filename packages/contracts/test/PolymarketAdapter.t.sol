// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
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
    address vault = address(0xA1);
    address rando = address(0xB2);

    bytes32 marketId = keccak256("POLY-MARKET-1");
    bytes32 conditionId = keccak256("CONDITION-1");

    function setUp() public {
        usdc = new MockUSDT();
        ctf = new MockConditionalTokens(address(usdc));

        adapter = new PolymarketAdapter(address(usdc), address(ctf));

        // Add vault as approved caller
        adapter.addCaller(vault);

        // Register market
        adapter.registerMarket(marketId, conditionId);

        // Fund CTF with collateral so it can pay out on merges/redemptions
        usdc.mint(address(ctf), 1_000_000e6);

        // Fund vault
        usdc.mint(vault, 100_000e6);
    }

    // --- Market registration ---

    function test_registerMarket() public {
        bytes32 mId = keccak256("NEW-MARKET");
        bytes32 cId = keccak256("NEW-CONDITION");
        adapter.registerMarket(mId, cId);

        (bytes32 storedConditionId, uint256 yesPositionId, uint256 noPositionId, bool registered, bool redeemed) =
            adapter.markets(mId);

        assertTrue(registered);
        assertFalse(redeemed);
        assertEq(storedConditionId, cId);
        assertTrue(yesPositionId != 0);
        assertTrue(noPositionId != 0);
        assertTrue(yesPositionId != noPositionId);
    }

    // --- Quotes ---

    function test_setQuote() public {
        adapter.setQuote(marketId, 0.55e18, 0.45e18, 10_000e6, 8_000e6);

        MarketQuoteHelper.MarketQuote memory q = MarketQuoteHelper.getQuote(adapter, marketId);
        assertEq(q.yesPrice, 0.55e18);
        assertEq(q.noPrice, 0.45e18);
        assertEq(q.yesLiquidity, 10_000e6);
        assertEq(q.noLiquidity, 8_000e6);
        assertFalse(q.resolved);
    }

    // --- Access control ---

    function test_onlyApproved_buyOutcome() public {
        vm.prank(rando);
        vm.expectRevert("not approved");
        adapter.buyOutcome(marketId, true, 100e6);
    }

    function test_onlyApproved_sellOutcome() public {
        vm.prank(rando);
        vm.expectRevert("not approved");
        adapter.sellOutcome(marketId, true, 100e6);
    }

    function test_onlyApproved_redeem() public {
        ctf.resolve(conditionId, true);

        vm.prank(rando);
        vm.expectRevert("not approved");
        adapter.redeem(marketId);
    }

    function test_ownerCanCallWithoutBeingApproved() public {
        // Owner is implicitly approved via the onlyApproved modifier
        usdc.mint(owner, 100e6);
        usdc.approve(address(adapter), 100e6);
        uint256 shares = adapter.buyOutcome(marketId, true, 100e6);
        assertEq(shares, 100e6);
    }

    function test_addCaller_onlyOwner() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        adapter.addCaller(address(0xC3));
    }

    function test_removeCaller() public {
        adapter.addCaller(address(0xC3));
        assertTrue(adapter.approvedCallers(address(0xC3)));

        adapter.removeCaller(address(0xC3));
        assertFalse(adapter.approvedCallers(address(0xC3)));
    }

    function test_addCaller_zeroAddress() public {
        vm.expectRevert("zero address");
        adapter.addCaller(address(0));
    }

    function test_onlyOwner_registerMarket() public {
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, vault));
        adapter.registerMarket(keccak256("x"), keccak256("y"));
    }

    function test_onlyOwner_setQuote() public {
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, vault));
        adapter.setQuote(marketId, 0.55e18, 0.45e18, 10_000e6, 8_000e6);
    }

    // --- Buy outcome ---

    function test_buyOutcome_yes() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        uint256 shares = adapter.buyOutcome(marketId, true, amount);
        vm.stopPrank();

        assertEq(shares, amount); // 1:1 split
        assertEq(adapter.yesBalance(marketId), amount);
        assertEq(adapter.noBalance(marketId), 0);
        // Unwanted NO side goes to inventory
        assertEq(adapter.noInventory(marketId), amount);
    }

    function test_buyOutcome_no() public {
        uint256 amount = 50e6;
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        uint256 shares = adapter.buyOutcome(marketId, false, amount);
        vm.stopPrank();

        assertEq(shares, amount);
        assertEq(adapter.noBalance(marketId), amount);
        assertEq(adapter.yesBalance(marketId), 0);
        // Unwanted YES side goes to inventory
        assertEq(adapter.yesInventory(marketId), amount);
    }

    function test_buyOutcome_usesInventory() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);

        // First buy YES — creates NO inventory
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);
        assertEq(adapter.noInventory(marketId), amount);

        // Now buy NO — should use NO inventory instead of splitting
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, false, amount);
        vm.stopPrank();

        assertEq(adapter.noInventory(marketId), 0); // inventory consumed
        assertEq(adapter.yesBalance(marketId), amount);
        assertEq(adapter.noBalance(marketId), amount);
    }

    // --- Sell outcome ---

    function test_sellOutcome() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);

        // Now sell YES — merges with NO inventory and returns collateral
        uint256 balBefore = usdc.balanceOf(vault);
        uint256 payout = adapter.sellOutcome(marketId, true, amount);
        uint256 balAfter = usdc.balanceOf(vault);
        vm.stopPrank();

        assertEq(payout, amount); // full merge possible since split created equal NO inventory
        assertEq(balAfter - balBefore, amount);
        assertEq(adapter.yesBalance(marketId), 0);
        assertEq(adapter.noInventory(marketId), 0);
    }

    function test_sellOutcome_insufficientBalance() public {
        vm.prank(vault);
        vm.expectRevert("insufficient balance");
        adapter.sellOutcome(marketId, true, 100e6);
    }

    function test_sellOutcome_insufficientInventory() public {
        // Buy YES and NO — both create inventory for opposite side
        // But selling requires opposite inventory to merge
        uint256 amount = 100e6;
        vm.startPrank(vault);

        // Buy YES (creates NO inventory)
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);

        // Buy NO using the NO inventory — inventory now 0
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, false, amount);

        // Try selling YES — no NO inventory left, should revert
        // We have yesInventory = 100e6 from the second buy, but need noInventory to sell YES
        // Actually second buy of NO uses noInventory, so noInventory = 0.
        // yesInventory = 100e6 (from second buy that split).
        // Wait — second buy uses existing noInventory, so NO split happened. Let me recalculate.
        // After first buy YES (100e6): yesBalance=100, noInventory=100
        // Second buy NO (100e6): noInventory >= 100, so uses inventory. noInventory=0, noBalance=100
        // No new inventory created since we used existing.
        // Now: yesBalance=100, noBalance=100, yesInventory=0, noInventory=0
        // Selling YES requires noInventory >= amount. noInventory = 0. Should revert.

        vm.expectRevert("insufficient inventory to merge");
        adapter.sellOutcome(marketId, true, amount);
        vm.stopPrank();
    }

    // --- Redeem ---

    function test_redeem_yesWins() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);
        vm.stopPrank();

        // Resolve: YES wins
        ctf.resolve(conditionId, true);

        vm.prank(vault);
        uint256 payout = adapter.redeem(marketId);

        // YES wins: YES tokens redeem at 1:1, NO inventory redeems at 0
        // payout = 100e6 (from YES tokens)
        assertEq(payout, amount);
        assertEq(adapter.yesBalance(marketId), 0);
        assertEq(adapter.noBalance(marketId), 0);
    }

    function test_redeem_noWins() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, false, amount);
        vm.stopPrank();

        // Resolve: NO wins
        ctf.resolve(conditionId, false);

        vm.prank(vault);
        uint256 payout = adapter.redeem(marketId);

        // NO wins: NO tokens redeem at 1:1, YES inventory redeems at 0
        assertEq(payout, amount);
        assertEq(adapter.yesBalance(marketId), 0);
        assertEq(adapter.noBalance(marketId), 0);
    }

    function test_redeem_onlyOnce() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);
        vm.stopPrank();

        ctf.resolve(conditionId, true);

        // First redeem gets the payout
        vm.prank(vault);
        uint256 payout1 = adapter.redeem(marketId);
        assertEq(payout1, amount);

        // Second redeem returns 0 (already redeemed, balances reset)
        vm.prank(vault);
        uint256 payout2 = adapter.redeem(marketId);
        assertEq(payout2, 0);
    }

    function test_redeem_notResolved() public {
        vm.prank(vault);
        vm.expectRevert("not resolved");
        adapter.redeem(marketId);
    }

    // --- isResolved ---

    function test_isResolved() public {
        assertFalse(adapter.isResolved(marketId));

        ctf.resolve(conditionId, true);

        assertTrue(adapter.isResolved(marketId));
    }

    // --- Ownable2Step ---

    function test_transferOwnership_twoStep() public {
        address newOwner = address(0xBEEF);
        adapter.transferOwnership(newOwner);
        // Still pending
        assertEq(adapter.owner(), address(this));
        // New owner accepts
        vm.prank(newOwner);
        adapter.acceptOwnership();
        assertEq(adapter.owner(), newOwner);
    }

    function test_transferOwnership_pendingOwnerOnly() public {
        address newOwner = address(0xBEEF);
        adapter.transferOwnership(newOwner);

        // Random address cannot accept
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        adapter.acceptOwnership();
    }

    // --- Constructor ---

    function test_constructor_zeroCollateral() public {
        vm.expectRevert("zero collateral");
        new PolymarketAdapter(address(0), address(ctf));
    }

    function test_constructor_zeroCTF() public {
        vm.expectRevert("zero ctf");
        new PolymarketAdapter(address(usdc), address(0));
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
        (bytes32 mid, uint256 yp, uint256 np, uint256 yl, uint256 nl, bool res) =
            abi.decode(abi.encode(adapter.getQuote(marketId)), (bytes32, uint256, uint256, uint256, uint256, bool));
        q = MarketQuote(mid, yp, np, yl, nl, res);
    }
}
