// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";

contract ProphitVault is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Types ---
    struct Position {
        address adapterA;
        address adapterB;
        bytes32 marketIdA;
        bytes32 marketIdB;
        bool boughtYesOnA; // bought YES on A, NO on B
        uint256 sharesA;
        uint256 sharesB;
        uint256 costA;
        uint256 costB;
        uint256 openedAt;
        bool closed;
    }

    // --- State ---
    IERC20 public immutable usdt;
    address public agent;

    Position[] public positions;
    mapping(address => bool) public approvedAdapters;

    // Circuit breakers
    uint256 public dailyTradeLimit;    // max trades per day
    uint256 public dailyLossLimit;     // max loss per day (6 decimals)
    uint256 public positionSizeCap;    // max USDT per side of a position
    uint256 public cooldownSeconds;    // min seconds between trades

    // Circuit breaker tracking
    uint256 public tradesToday;
    uint256 public lossToday;
    uint256 public lastTradeDay;
    uint256 public lastTradeTimestamp;

    // --- Events ---
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PositionOpened(uint256 indexed positionId, bytes32 marketIdA, bytes32 marketIdB, uint256 costA, uint256 costB);
    event PositionClosed(uint256 indexed positionId, uint256 payout);
    event AgentUpdated(address indexed newAgent);
    event AdapterApproved(address indexed adapter);
    event AdapterRemoved(address indexed adapter);
    event CircuitBreakersUpdated(uint256 dailyTradeLimit, uint256 dailyLossLimit, uint256 positionSizeCap, uint256 cooldownSeconds);

    // --- Modifiers ---
    modifier onlyAgent() {
        require(msg.sender == agent, "not agent");
        _;
    }

    constructor(address _usdt, address _agent) Ownable(msg.sender) {
        require(_usdt != address(0), "zero usdt");
        require(_agent != address(0), "zero agent");
        usdt = IERC20(_usdt);
        agent = _agent;

        // Defaults (USDT has 6 decimals)
        dailyTradeLimit = 50;
        dailyLossLimit = 1000e6;
        positionSizeCap = 500e6;
        cooldownSeconds = 10;
    }

    // --- Owner functions ---
    function deposit(uint256 amount) external onlyOwner {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external onlyOwner {
        usdt.safeTransfer(owner(), amount);
        emit Withdrawn(owner(), amount);
    }

    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "zero agent");
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    function approveAdapter(address adapter) external onlyOwner {
        require(adapter != address(0), "zero adapter");
        approvedAdapters[adapter] = true;
        emit AdapterApproved(adapter);
    }

    function removeAdapter(address adapter) external onlyOwner {
        approvedAdapters[adapter] = false;
        emit AdapterRemoved(adapter);
    }

    function setCircuitBreakers(
        uint256 _dailyTradeLimit,
        uint256 _dailyLossLimit,
        uint256 _positionSizeCap,
        uint256 _cooldownSeconds
    ) external onlyOwner {
        dailyTradeLimit = _dailyTradeLimit;
        dailyLossLimit = _dailyLossLimit;
        positionSizeCap = _positionSizeCap;
        cooldownSeconds = _cooldownSeconds;
        emit CircuitBreakersUpdated(_dailyTradeLimit, _dailyLossLimit, _positionSizeCap, _cooldownSeconds);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- Agent functions ---
    function openPosition(
        address adapterA,
        address adapterB,
        bytes32 marketIdA,
        bytes32 marketIdB,
        bool buyYesOnA,
        uint256 amountA,
        uint256 amountB,
        uint256 minSharesA,
        uint256 minSharesB
    ) external onlyAgent whenNotPaused nonReentrant returns (uint256 positionId) {
        // Adapter whitelist
        require(approvedAdapters[adapterA], "adapter A not approved");
        require(approvedAdapters[adapterB], "adapter B not approved");

        // Circuit breaker checks
        _resetDayIfNeeded();
        require(tradesToday < dailyTradeLimit, "daily trade limit");
        require(amountA <= positionSizeCap, "amount A exceeds cap");
        require(amountB <= positionSizeCap, "amount B exceeds cap");
        require(
            block.timestamp >= lastTradeTimestamp + cooldownSeconds,
            "cooldown active"
        );

        // Approve adapters
        usdt.forceApprove(adapterA, amountA);
        usdt.forceApprove(adapterB, amountB);

        // Execute trades
        uint256 sharesA = IProtocolAdapter(adapterA).buyOutcome(marketIdA, buyYesOnA, amountA);
        uint256 sharesB = IProtocolAdapter(adapterB).buyOutcome(marketIdB, !buyYesOnA, amountB);

        // Reset approvals to prevent dangling allowance
        usdt.forceApprove(adapterA, 0);
        usdt.forceApprove(adapterB, 0);

        require(sharesA >= minSharesA, "slippage A");
        require(sharesB >= minSharesB, "slippage B");

        // Store position
        positionId = positions.length;
        positions.push(Position({
            adapterA: adapterA,
            adapterB: adapterB,
            marketIdA: marketIdA,
            marketIdB: marketIdB,
            boughtYesOnA: buyYesOnA,
            sharesA: sharesA,
            sharesB: sharesB,
            costA: amountA,
            costB: amountB,
            openedAt: block.timestamp,
            closed: false
        }));

        // Update circuit breakers
        tradesToday++;
        lastTradeTimestamp = block.timestamp;

        emit PositionOpened(positionId, marketIdA, marketIdB, amountA, amountB);
    }

    function closePosition(uint256 positionId, uint256 minPayout) external onlyAgent whenNotPaused nonReentrant returns (uint256 totalPayout) {
        Position storage pos = positions[positionId];
        require(!pos.closed, "already closed");

        // CEI: mark closed before external calls to prevent reentrancy
        pos.closed = true;

        uint256 balBefore = usdt.balanceOf(address(this));
        IProtocolAdapter(pos.adapterA).redeem(pos.marketIdA);
        IProtocolAdapter(pos.adapterB).redeem(pos.marketIdB);
        uint256 balAfter = usdt.balanceOf(address(this));
        totalPayout = balAfter - balBefore;

        require(totalPayout >= minPayout, "payout below min");

        uint256 totalCost = pos.costA + pos.costB;
        if (totalPayout < totalCost) {
            uint256 loss = totalCost - totalPayout;
            _resetDayIfNeeded();
            lossToday += loss;
            require(lossToday <= dailyLossLimit, "daily loss limit");
        }

        emit PositionClosed(positionId, totalPayout);
    }

    // --- View functions ---
    function positionCount() external view returns (uint256) {
        return positions.length;
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    function vaultBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    // --- Internal ---
    function _resetDayIfNeeded() internal {
        uint256 today = block.timestamp / 1 days;
        if (today != lastTradeDay) {
            lastTradeDay = today;
            tradesToday = 0;
            lossToday = 0;
        }
    }
}
