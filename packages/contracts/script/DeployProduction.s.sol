// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ProphetVault} from "../src/ProphetVault.sol";
import {OpinionAdapter} from "../src/adapters/OpinionAdapter.sol";
import {PredictAdapter} from "../src/adapters/PredictAdapter.sol";
import {ProbableAdapter} from "../src/adapters/ProbableAdapter.sol";

/// @title DeployProduction
/// @notice Production deploy script for BSC mainnet.
///
/// Required env vars:
///   PRIVATE_KEY      — deployer private key
///   AGENT_ADDRESS    — address of the trading agent
///
/// Optional env vars (circuit breaker overrides):
///   DAILY_TRADE_LIMIT  — max trades per day        (default: 20)
///   DAILY_LOSS_LIMIT   — max daily loss in USDT    (default: $500 = 500e6)
///   POSITION_SIZE_CAP  — max per-side collateral   (default: $200 = 200e6)
///   COOLDOWN_SECONDS   — min seconds between trades (default: 30)
///
/// Usage:
///   forge script script/DeployProduction.s.sol:DeployProduction \
///     --rpc-url bsc --broadcast --verify
contract DeployProduction is Script {
    // --- BSC mainnet addresses ---
    address constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;

    // Gnosis CTF deployments
    address constant OPINION_CTF  = 0xAD1a38cEc043e70E83a3eC30443dB285ED10D774;
    address constant PREDICT_CTF  = 0xc5d01939Af7Ce9Ffc505F0bb36eFeDde7920f2dc;
    address constant PROBABLE_CTF = 0x364d05055614B506e2b9A287E4ac34167204cA83;

    // Exchange / router addresses (logged for reference, not used in deploy)
    address constant PROBABLE_EXCHANGE = 0x616C31a93769e32781409518FA2A57f3857cDD24;
    address constant PREDICT_EXCHANGE  = 0x8BC070BEdAB741406F4B1Eb65A72bee27894B689;

    function run() external {
        require(block.chainid == 56, "This script is for BSC mainnet only (chainId 56)");

        // All values MUST come from env — no fallbacks for critical params
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");

        // Circuit breaker config (18-decimal BSC USDT)
        uint256 dailyTradeLimit = vm.envOr("DAILY_TRADE_LIMIT", uint256(20));
        uint256 dailyLossLimit  = vm.envOr("DAILY_LOSS_LIMIT", uint256(500e18));   // $500
        uint256 positionSizeCap = vm.envOr("POSITION_SIZE_CAP", uint256(200e18));  // $200
        uint256 cooldownSeconds = vm.envOr("COOLDOWN_SECONDS", uint256(30));

        address deployer = vm.addr(deployerKey);

        console2.log("=== BSC Production Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Agent:", agent);
        console2.log("USDT:", BSC_USDT);

        vm.startBroadcast(deployerKey);

        // 1. Deploy ProphetVault
        ProphetVault vault = new ProphetVault(BSC_USDT, agent);
        console2.log("ProphetVault:", address(vault));

        // 2. Deploy adapters — each takes (ctf, collateral)
        OpinionAdapter opinionAdapter = new OpinionAdapter(OPINION_CTF, BSC_USDT);
        console2.log("OpinionAdapter:", address(opinionAdapter));

        PredictAdapter predictAdapter = new PredictAdapter(PREDICT_CTF, BSC_USDT);
        console2.log("PredictAdapter:", address(predictAdapter));

        ProbableAdapter probableAdapter = new ProbableAdapter(PROBABLE_CTF, BSC_USDT);
        console2.log("ProbableAdapter:", address(probableAdapter));

        // 3. Register adapters with the vault
        vault.approveAdapter(address(opinionAdapter));
        vault.approveAdapter(address(predictAdapter));
        vault.approveAdapter(address(probableAdapter));
        console2.log("All adapters approved on vault");

        // 4. Whitelist the vault as an approved caller on each adapter
        opinionAdapter.addCaller(address(vault));
        predictAdapter.addCaller(address(vault));
        probableAdapter.addCaller(address(vault));
        console2.log("Vault whitelisted on all adapters");

        // 5. Set circuit breakers
        vault.setCircuitBreakers(dailyTradeLimit, dailyLossLimit, positionSizeCap, cooldownSeconds);
        console2.log("Circuit breakers set");
        console2.log("  dailyTradeLimit:", dailyTradeLimit);
        console2.log("  dailyLossLimit:", dailyLossLimit);
        console2.log("  positionSizeCap:", positionSizeCap);
        console2.log("  cooldownSeconds:", cooldownSeconds);

        // NOTE: USDT approvals from vault to adapters are handled per-trade via
        // forceApprove() in ProphetVault.openPosition(). No standing approval needed.

        vm.stopBroadcast();

        // --- Summary ---
        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("ProphetVault:    ", address(vault));
        console2.log("OpinionAdapter:  ", address(opinionAdapter));
        console2.log("PredictAdapter:  ", address(predictAdapter));
        console2.log("ProbableAdapter: ", address(probableAdapter));
        console2.log("");
        console2.log("CTF addresses:");
        console2.log("  Opinion CTF:   ", OPINION_CTF);
        console2.log("  Predict CTF:   ", PREDICT_CTF);
        console2.log("  Probable CTF:  ", PROBABLE_CTF);
        console2.log("");
        console2.log("Exchange addresses (for reference):");
        console2.log("  Probable:      ", PROBABLE_EXCHANGE);
        console2.log("  Predict:       ", PREDICT_EXCHANGE);
        console2.log("");
        console2.log("IMPORTANT: Deposit USDT into the vault manually after verifying contracts.");
        console2.log("IMPORTANT: Transfer adapter ownership to a multisig after initial setup.");
    }
}
