import type { PublicClient } from "viem";
import type { ArbitOpportunity, Position } from "../types.js";
import type { VaultClient } from "./vault-client.js";
import type { Config } from "../config.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";

const isResolvedAbi = [
  {
    type: "function",
    name: "isResolved",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

export class Executor {
  private vaultClient: VaultClient;
  private config: Config;
  private publicClient: PublicClient;

  constructor(vaultClient: VaultClient, config: Config, publicClient: PublicClient) {
    this.vaultClient = vaultClient;
    this.config = config;
    this.publicClient = publicClient;
  }

  async executeBest(opportunity: ArbitOpportunity, maxPositionSize: bigint): Promise<void> {
    // Split maxPositionSize evenly between A and B sides
    let amountPerSide = maxPositionSize / 2n;

    // Cap position size to available liquidity (use 90% to leave room for slippage)
    if (opportunity.liquidityA > 0n && opportunity.liquidityA < amountPerSide) {
      const capped = opportunity.liquidityA * 90n / 100n;
      if (capped === 0n) {
        log.info("Insufficient liquidity on protocol A", {
          available: opportunity.liquidityA.toString(),
          needed: amountPerSide.toString(),
        });
        return;
      }
      log.info("Capping position size to liquidity on A", {
        original: amountPerSide.toString(),
        capped: capped.toString(),
      });
      amountPerSide = capped;
    }
    if (opportunity.liquidityB > 0n && opportunity.liquidityB < amountPerSide) {
      const capped = opportunity.liquidityB * 90n / 100n;
      if (capped === 0n) {
        log.info("Insufficient liquidity on protocol B", {
          available: opportunity.liquidityB.toString(),
          needed: amountPerSide.toString(),
        });
        return;
      }
      log.info("Capping position size to liquidity on B", {
        original: amountPerSide.toString(),
        capped: capped.toString(),
      });
      amountPerSide = capped;
    }

    // Check vault balance before trading
    const vaultBalance = await this.vaultClient.getVaultBalance();
    const totalNeeded = amountPerSide * 2n;
    if (vaultBalance < totalNeeded) {
      log.info("Insufficient vault balance", { vaultBalance: vaultBalance.toString(), totalNeeded: totalNeeded.toString() });
      return;
    }

    // Estimate gas cost for profitability check
    try {
      const gasPrice = await withRetry(
        () => this.vaultClient.publicClient.getGasPrice(),
        { label: "getGasPrice" },
      );
      // openPosition typically uses ~400k gas
      const estimatedGasCost = gasPrice * 400_000n;

      // Convert gas cost (in native token wei) to approximate USDT value
      // gasToUsdtRate = native token price in 6-decimal USDT (e.g., $3000 ETH = 3000_000_000n)
      const gasCostUsdt = (estimatedGasCost * this.config.gasToUsdtRate) / BigInt(1e18);

      if (opportunity.estProfit <= gasCostUsdt) {
        log.info("Trade unprofitable after gas", { profit: opportunity.estProfit.toString(), gasCost: gasCostUsdt.toString() });
        return;
      }
    } catch (e) {
      log.warn("Gas estimation failed, proceeding anyway", { error: String(e) });
    }

    log.info("Executing arb", {
      protocolA: opportunity.protocolA,
      protocolB: opportunity.protocolB,
      spreadBps: opportunity.spreadBps,
      buyYesOnA: opportunity.buyYesOnA,
      amountPerSide: amountPerSide.toString(),
    });

    // Slippage protection: expect at least 95% of estimated shares
    const minSharesA =
      opportunity.yesPriceA > 0n
        ? (amountPerSide * BigInt(1e18)) / opportunity.yesPriceA * 95n / 100n
        : 0n;
    const minSharesB =
      opportunity.noPriceB > 0n
        ? (amountPerSide * BigInt(1e18)) / opportunity.noPriceB * 95n / 100n
        : 0n;

    try {
      const positionId = await this.vaultClient.openPosition({
        adapterA: this.config.adapterAAddress,
        adapterB: this.config.adapterBAddress,
        marketIdA: this.config.marketId,
        marketIdB: this.config.marketId,
        buyYesOnA: opportunity.buyYesOnA,
        amountA: amountPerSide,
        amountB: amountPerSide,
        minSharesA,
        minSharesB,
      });

      log.info("Position opened", { positionId: positionId.toString() });
    } catch (err) {
      log.error("Failed to execute trade", { error: String(err) });
      throw err;
    }
  }

  async closeResolved(positions: Position[]): Promise<number> {
    let closed = 0;

    for (const pos of positions) {
      if (pos.closed) continue;

      try {
        // Check if either side's market is resolved
        const [resolvedA, resolvedB] = await Promise.all([
          this.publicClient.readContract({
            address: pos.adapterA,
            abi: isResolvedAbi,
            functionName: "isResolved",
            args: [pos.marketIdA],
          }),
          this.publicClient.readContract({
            address: pos.adapterB,
            abi: isResolvedAbi,
            functionName: "isResolved",
            args: [pos.marketIdB],
          }),
        ]);

        if (resolvedA && resolvedB) {
          log.info("Closing resolved position", { positionId: pos.positionId });
          const payout = await this.vaultClient.closePosition(pos.positionId, 0n);
          log.info("Position closed", {
            positionId: pos.positionId,
            payout: payout.toString(),
          });
          closed++;
        }
      } catch (err) {
        log.error("Failed to close position", {
          positionId: pos.positionId,
          error: String(err),
        });
      }
    }

    return closed;
  }
}
