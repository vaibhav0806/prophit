// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {MockAdapter} from "../src/mocks/MockAdapter.sol";
import {ProphetVault} from "../src/ProphetVault.sol";

contract Deploy is Script {
    function run() external {
        require(block.chainid == 31337, "Deploy.s.sol is for local dev only. Use DeployProduction.s.sol for real chains.");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address agent = vm.envOr("AGENT_ADDRESS", deployer);

        vm.startBroadcast(deployerKey);

        // 1. Deploy MockUSDT
        MockUSDT usdt = new MockUSDT();
        console2.log("MockUSDT:", address(usdt));

        // 2. Deploy two MockAdapters with different prices
        MockAdapter adapterA = new MockAdapter(address(usdt));
        MockAdapter adapterB = new MockAdapter(address(usdt));
        console2.log("MockAdapterA:", address(adapterA));
        console2.log("MockAdapterB:", address(adapterB));

        // 3. Set up market with price discrepancy
        bytes32 marketId = keccak256("BTC-100K-2025");

        // Adapter A: YES $0.55, NO $0.50 (sum $1.05 — slightly overpriced)
        adapterA.setQuote(marketId, 0.55e18, 0.50e18, 50_000e6, 50_000e6);
        // Adapter B: YES $0.60, NO $0.42 (sum $1.02 — slightly overpriced)
        adapterB.setQuote(marketId, 0.60e18, 0.42e18, 50_000e6, 50_000e6);

        // Arbitrage: buy YES on A @0.55 + buy NO on B @0.42 = $0.97 for guaranteed $1.00 = 3% profit

        console2.log("MarketId (BTC-100K-2025):", vm.toString(marketId));

        // 4. Deploy ProphetVault
        ProphetVault vault = new ProphetVault(address(usdt), agent);
        console2.log("ProphetVault:", address(vault));

        // Approve adapters on the vault
        vault.approveAdapter(address(adapterA));
        vault.approveAdapter(address(adapterB));

        // 5. Fund everything
        usdt.mint(deployer, 100_000e6);
        usdt.mint(address(adapterA), 100_000e6);
        usdt.mint(address(adapterB), 100_000e6);

        // Deposit into vault
        usdt.approve(address(vault), 50_000e6);
        vault.deposit(50_000e6);
        console2.log("Vault funded with 50,000 USDT");

        // Set relaxed circuit breakers for demo
        vault.setCircuitBreakers(100, 10_000e6, 5_000e6, 5);

        vm.stopBroadcast();

        console2.log("--- Deployment Complete ---");
        console2.log("Deployer:", deployer);
        console2.log("Agent:", agent);
    }
}
