// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IConditionalTokens} from "../src/interfaces/IConditionalTokens.sol";
import {ProbableAdapter} from "../src/adapters/ProbableAdapter.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";

// --- Mock Conditional Tokens ---

contract MockConditionalTokens is IConditionalTokens {
    IERC20 public collateral;

    mapping(bytes32 => mapping(uint256 => uint256)) internal _payoutNumerators;
    mapping(bytes32 => uint256) internal _payoutDenominator;
    mapping(uint256 => mapping(address => uint256)) internal _balances;

    constructor(address _collateral) {
        collateral = IERC20(_collateral);
    }

    function splitPosition(
        IERC20 collateralToken,
        bytes32,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external override {
        collateralToken.transferFrom(msg.sender, address(this), amount);

        bytes32 yesCollId = getCollectionId(bytes32(0), conditionId, partition[0]);
        bytes32 noCollId = getCollectionId(bytes32(0), conditionId, partition[1]);
        uint256 yesPos = getPositionId(collateralToken, yesCollId);
        uint256 noPos = getPositionId(collateralToken, noCollId);

        _balances[yesPos][msg.sender] += amount;
        _balances[noPos][msg.sender] += amount;
    }

    function mergePositions(
        IERC20 collateralToken,
        bytes32,
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

        collateralToken.transfer(msg.sender, amount);
    }

    function redeemPositions(
        IERC20 collateralToken,
        bytes32,
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

    function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) public pure override returns (bytes32) {
        return keccak256(abi.encodePacked(parentCollectionId, conditionId, indexSet));
    }

    function getPositionId(IERC20 collateralToken, bytes32 collectionId) public pure override returns (uint256) {
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
            _payoutNumerators[conditionId][0] = 1;
            _payoutNumerators[conditionId][1] = 0;
        } else {
            _payoutNumerators[conditionId][0] = 0;
            _payoutNumerators[conditionId][1] = 1;
        }
    }
}

// --- Test Contract ---

contract ProbableAdapterTest is Test {
    ProbableAdapter adapter;
    MockUSDT usdt;
    MockConditionalTokens ctf;

    address owner = address(this);
    address vault = address(0xA1);
    address rando = address(0xB2);

    bytes32 marketId = keccak256("PROBABLE-MARKET-1");
    bytes32 conditionId = keccak256("CONDITION-1");

    function setUp() public {
        usdt = new MockUSDT();
        ctf = new MockConditionalTokens(address(usdt));

        adapter = new ProbableAdapter(address(ctf), address(usdt));

        // Add vault as approved caller
        adapter.addCaller(vault);

        // Register market
        adapter.registerMarket(marketId, conditionId);

        // Fund CTF with collateral for merges/redemptions
        usdt.mint(address(ctf), 1_000_000e6);

        // Fund vault
        usdt.mint(vault, 100_000e6);
    }

    // ======== Constructor ========

    function test_constructor_zeroCTF() public {
        vm.expectRevert("zero ctf");
        new ProbableAdapter(address(0), address(usdt));
    }

    function test_constructor_zeroCollateral() public {
        vm.expectRevert("zero collateral");
        new ProbableAdapter(address(ctf), address(0));
    }

    // ======== Access Control ========

    function test_addCaller() public {
        address newCaller = address(0xC3);
        adapter.addCaller(newCaller);
        assertTrue(adapter.approvedCallers(newCaller));
    }

    function test_addCaller_zeroAddress() public {
        vm.expectRevert("zero address");
        adapter.addCaller(address(0));
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
        usdt.mint(owner, 100e6);
        usdt.approve(address(adapter), 100e6);
        uint256 shares = adapter.buyOutcome(marketId, true, 100e6);
        assertEq(shares, 100e6);
    }

    // ======== Market Registration ========

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

    function test_registerMarket_onlyOwner() public {
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, vault));
        adapter.registerMarket(keccak256("x"), keccak256("y"));
    }

    // ======== Quotes (stored, set by owner/keeper) ========

    function test_setQuote() public {
        adapter.setQuote(marketId, 0.55e18, 0.45e18, 10_000e6, 8_000e6);

        ProbableAdapterQuoteHelper.MarketQuote memory q = ProbableAdapterQuoteHelper.getQuote(adapter, marketId);
        assertEq(q.yesPrice, 0.55e18);
        assertEq(q.noPrice, 0.45e18);
        assertEq(q.yesLiquidity, 10_000e6);
        assertEq(q.noLiquidity, 8_000e6);
        assertFalse(q.resolved);
    }

    function test_setQuote_onlyOwner() public {
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, vault));
        adapter.setQuote(marketId, 0.55e18, 0.45e18, 10_000e6, 8_000e6);
    }

    function test_getQuote_defaultZeros() public {
        bytes32 mId = keccak256("NO-QUOTE-MARKET");
        bytes32 cId = keccak256("NO-QUOTE-CONDITION");
        adapter.registerMarket(mId, cId);

        ProbableAdapterQuoteHelper.MarketQuote memory q = ProbableAdapterQuoteHelper.getQuote(adapter, mId);
        assertEq(q.yesPrice, 0);
        assertEq(q.noPrice, 0);
        assertEq(q.yesLiquidity, 0);
        assertEq(q.noLiquidity, 0);
        assertFalse(q.resolved);
    }

    function test_getQuote_reflectsResolution() public {
        adapter.setQuote(marketId, 0.55e18, 0.45e18, 10_000e6, 8_000e6);

        ProbableAdapterQuoteHelper.MarketQuote memory q1 = ProbableAdapterQuoteHelper.getQuote(adapter, marketId);
        assertFalse(q1.resolved);

        ctf.resolve(conditionId, true);

        ProbableAdapterQuoteHelper.MarketQuote memory q2 = ProbableAdapterQuoteHelper.getQuote(adapter, marketId);
        assertTrue(q2.resolved);
    }

    // ======== Buy Outcome (CTF split) ========

    function test_buyOutcome_yes() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdt.approve(address(adapter), amount);
        uint256 shares = adapter.buyOutcome(marketId, true, amount);
        vm.stopPrank();

        assertEq(shares, amount);
        assertEq(adapter.yesBalance(marketId), amount);
        assertEq(adapter.noBalance(marketId), 0);
        assertEq(adapter.noInventory(marketId), amount);
    }

    function test_buyOutcome_no() public {
        uint256 amount = 50e6;
        vm.startPrank(vault);
        usdt.approve(address(adapter), amount);
        uint256 shares = adapter.buyOutcome(marketId, false, amount);
        vm.stopPrank();

        assertEq(shares, amount);
        assertEq(adapter.noBalance(marketId), amount);
        assertEq(adapter.yesBalance(marketId), 0);
        assertEq(adapter.yesInventory(marketId), amount);
    }

    function test_buyOutcome_usesInventory() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);

        // Buy YES -- creates NO inventory
        usdt.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);
        assertEq(adapter.noInventory(marketId), amount);

        // Buy NO -- uses NO inventory instead of splitting
        usdt.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, false, amount);
        vm.stopPrank();

        assertEq(adapter.noInventory(marketId), 0);
        assertEq(adapter.yesBalance(marketId), amount);
        assertEq(adapter.noBalance(marketId), amount);
    }

    function test_buyOutcome_marketNotRegistered() public {
        vm.prank(vault);
        vm.expectRevert("market not registered");
        adapter.buyOutcome(keccak256("NONEXISTENT"), true, 100e6);
    }

    function test_buyOutcome_marketResolved() public {
        ctf.resolve(conditionId, true);
        vm.startPrank(vault);
        usdt.approve(address(adapter), 100e6);
        vm.expectRevert("market resolved");
        adapter.buyOutcome(marketId, true, 100e6);
        vm.stopPrank();
    }

    // ======== Sell Outcome (CTF merge) ========

    function test_sellOutcome() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdt.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);

        uint256 balBefore = usdt.balanceOf(vault);
        uint256 payout = adapter.sellOutcome(marketId, true, amount);
        uint256 balAfter = usdt.balanceOf(vault);
        vm.stopPrank();

        assertEq(payout, amount);
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
        uint256 amount = 100e6;
        vm.startPrank(vault);

        // Buy YES (creates NO inventory)
        usdt.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);

        // Buy NO using NO inventory -- inventory now 0
        usdt.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, false, amount);

        // Try selling YES -- no NO inventory left
        vm.expectRevert("insufficient inventory to merge");
        adapter.sellOutcome(marketId, true, amount);
        vm.stopPrank();
    }

    // ======== Redeem ========

    function test_redeem_yesWins() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdt.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);
        vm.stopPrank();

        ctf.resolve(conditionId, true);

        vm.prank(vault);
        uint256 payout = adapter.redeem(marketId);

        assertEq(payout, amount);
        assertEq(adapter.yesBalance(marketId), 0);
        assertEq(adapter.noBalance(marketId), 0);
    }

    function test_redeem_noWins() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdt.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, false, amount);
        vm.stopPrank();

        ctf.resolve(conditionId, false);

        vm.prank(vault);
        uint256 payout = adapter.redeem(marketId);

        assertEq(payout, amount);
    }

    function test_redeem_onlyOnce() public {
        uint256 amount = 100e6;
        vm.startPrank(vault);
        usdt.approve(address(adapter), amount);
        adapter.buyOutcome(marketId, true, amount);
        vm.stopPrank();

        ctf.resolve(conditionId, true);

        vm.prank(vault);
        uint256 payout1 = adapter.redeem(marketId);
        assertEq(payout1, amount);

        vm.prank(vault);
        uint256 payout2 = adapter.redeem(marketId);
        assertEq(payout2, 0);
    }

    function test_redeem_notResolved() public {
        vm.prank(vault);
        vm.expectRevert("not resolved");
        adapter.redeem(marketId);
    }

    function test_redeem_notRegistered() public {
        vm.prank(vault);
        vm.expectRevert("market not registered");
        adapter.redeem(keccak256("NONEXISTENT"));
    }

    // ======== isResolved ========

    function test_isResolved() public {
        assertFalse(adapter.isResolved(marketId));
        ctf.resolve(conditionId, true);
        assertTrue(adapter.isResolved(marketId));
    }

    function test_isResolved_unregisteredMarket() public {
        assertFalse(adapter.isResolved(keccak256("NONEXISTENT")));
    }

    // ======== Ownable2Step ========

    function test_transferOwnership_twoStep() public {
        address newOwner = address(0xBEEF);
        adapter.transferOwnership(newOwner);
        assertEq(adapter.owner(), address(this));
        vm.prank(newOwner);
        adapter.acceptOwnership();
        assertEq(adapter.owner(), newOwner);
    }

    function test_transferOwnership_pendingOwnerOnly() public {
        address newOwner = address(0xBEEF);
        adapter.transferOwnership(newOwner);
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        adapter.acceptOwnership();
    }

    // ======== ERC1155 Receiver ========

    function test_supportsInterface_erc1155Receiver() public {
        // IERC1155Receiver interface ID = 0x4e2312e0
        assertTrue(adapter.supportsInterface(0x4e2312e0));
    }

    function test_onERC1155Received() public {
        bytes4 selector = adapter.onERC1155Received(address(0), address(0), 0, 0, "");
        assertEq(selector, bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)")));
    }
}

// Helper to avoid import issues with the MarketQuote struct
library ProbableAdapterQuoteHelper {
    struct MarketQuote {
        bytes32 marketId;
        uint256 yesPrice;
        uint256 noPrice;
        uint256 yesLiquidity;
        uint256 noLiquidity;
        bool resolved;
    }

    function getQuote(ProbableAdapter adapter, bytes32 marketId) internal view returns (MarketQuote memory q) {
        (bytes32 mid, uint256 yp, uint256 np, uint256 yl, uint256 nl, bool res) =
            abi.decode(abi.encode(adapter.getQuote(marketId)), (bytes32, uint256, uint256, uint256, uint256, bool));
        q = MarketQuote(mid, yp, np, yl, nl, res);
    }
}
