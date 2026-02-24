import type { PublicClient, WalletClient } from "viem";
import type { ArbitOpportunity, Position, ClobPosition, ClobLeg, MarketMeta, ExecutionMode } from "../types.js";
import type { VaultClient } from "./vault-client.js";
import type { ClobClient, PlaceOrderParams, OrderStatus } from "../clob/types.js";
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

const payoutDenominatorAbi = [
  {
    type: "function",
    name: "payoutDenominator",
    inputs: [{ name: "conditionId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const redeemPositionsAbi = [
  {
    type: "function",
    name: "redeemPositions",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const CTF_ADDRESSES: Record<string, `0x${string}`> = {
  probable: "0x364d05055614B506e2b9A287E4ac34167204cA83",
  predict: "0x22DA1810B194ca018378464a58f6Ac2B10C9d244",
};

interface ClobClients {
  probable?: ClobClient;
  predict?: ClobClient;
}

interface MarketMetaResolver {
  getMarketMeta(marketId: `0x${string}`): MarketMeta | undefined;
}

export class Executor {
  private vaultClient: VaultClient | null;
  private config: Config;
  private publicClient: PublicClient;
  private clobClients: ClobClients;
  private metaResolvers: Map<string, MarketMetaResolver>;
  private walletClient: WalletClient | null;
  private paused = false;

  constructor(
    vaultClient: VaultClient | undefined,
    config: Config,
    publicClient: PublicClient,
    clobClients?: ClobClients,
    metaResolvers?: Map<string, MarketMetaResolver>,
    walletClient?: WalletClient,
  ) {
    this.vaultClient = vaultClient ?? null;
    this.config = config;
    this.publicClient = publicClient;
    this.clobClients = clobClients ?? {};
    this.metaResolvers = metaResolvers ?? new Map();
    this.walletClient = walletClient ?? null;
  }

  isPaused(): boolean {
    return this.paused;
  }

  unpause(): void {
    this.paused = false;
    log.info("Executor unpaused");
  }

  async executeBest(opportunity: ArbitOpportunity, maxPositionSize: bigint): Promise<ClobPosition | void> {
    if (this.paused) {
      log.warn("Executor is paused due to partial fill — skipping execution");
      return;
    }
    if (this.config.executionMode === "clob") {
      return this.executeClob(opportunity, maxPositionSize);
    }
    if (!this.vaultClient) {
      log.error("Vault mode requested but no vaultClient configured");
      return;
    }
    return this.executeVault(opportunity, maxPositionSize);
  }

  // ---------------------------------------------------------------------------
  // Vault mode (existing)
  // ---------------------------------------------------------------------------

  private async executeVault(opportunity: ArbitOpportunity, maxPositionSize: bigint): Promise<void> {
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
    const vaultBalance = await this.vaultClient!.getVaultBalance();
    const totalNeeded = amountPerSide * 2n;
    if (vaultBalance < totalNeeded) {
      log.info("Insufficient vault balance", { vaultBalance: vaultBalance.toString(), totalNeeded: totalNeeded.toString() });
      return;
    }

    // Estimate gas cost for profitability check
    try {
      const gasPrice = await withRetry(
        () => this.vaultClient!.publicClient.getGasPrice(),
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

    log.info("Executing arb (vault mode)", {
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
      const positionId = await this.vaultClient!.openPosition({
        adapterA: this.config.adapterAAddress!,
        adapterB: this.config.adapterBAddress!,
        marketIdA: this.config.marketId!,
        marketIdB: this.config.marketId!,
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

  // ---------------------------------------------------------------------------
  // CLOB mode (new)
  // ---------------------------------------------------------------------------

  private async executeClob(opportunity: ArbitOpportunity, maxPositionSize: bigint): Promise<ClobPosition | void> {
    const clientA = this.getClobClient(opportunity.protocolA);
    const clientB = this.getClobClient(opportunity.protocolB);

    if (!clientA || !clientB) {
      log.error("CLOB client not available for execution", {
        protocolA: opportunity.protocolA,
        protocolB: opportunity.protocolB,
        hasA: !!clientA,
        hasB: !!clientB,
      });
      return;
    }

    // Resolve token IDs via provider metadata
    const metaA = this.metaResolvers.get(opportunity.protocolA)?.getMarketMeta(opportunity.marketId);
    const metaB = this.metaResolvers.get(opportunity.protocolB)?.getMarketMeta(opportunity.marketId);

    if (!metaA || !metaB) {
      log.error("Cannot resolve market meta for CLOB execution", {
        marketId: opportunity.marketId,
        hasMetaA: !!metaA,
        hasMetaB: !!metaB,
      });
      return;
    }

    // Calculate size: cap to liquidity (90%)
    const SCALE = 1_000_000n;
    let sizeUsdt = Number(maxPositionSize / 2n) / 1_000_000; // Convert 6-dec to human

    const liqA = Number(opportunity.liquidityA) / 1_000_000;
    const liqB = Number(opportunity.liquidityB) / 1_000_000;

    if (liqA > 0 && liqA * 0.9 < sizeUsdt) sizeUsdt = liqA * 0.9;
    if (liqB > 0 && liqB * 0.9 < sizeUsdt) sizeUsdt = liqB * 0.9;

    if (sizeUsdt < 1) {
      log.info("CLOB: position size too small after liquidity cap", { sizeUsdt });
      return;
    }

    // Pre-check USDT balance (EOA — covers Predict; Probable checks Safe-side via API)
    const account = this.walletClient?.account;
    if (account && !this.config.dryRun) {
      try {
        const usdtBalance = await this.publicClient.readContract({
          address: BSC_USDT,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [account.address],
        });
        // BSC USDT is 18 decimals; total cost ≈ sizeUsdt * 2 legs
        const requiredWei = BigInt(Math.ceil(sizeUsdt * 2)) * 10n ** 18n;
        if (usdtBalance < requiredWei) {
          log.warn("CLOB: insufficient USDT balance, skipping", {
            balance: Number(usdtBalance / 10n ** 18n),
            required: sizeUsdt * 2,
          });
          return;
        }
      } catch (err) {
        log.warn("CLOB: failed to check USDT balance, proceeding anyway", { error: String(err) });
      }
    }

    // Determine legs
    // buyYesOnA=true: Buy YES on A, Buy NO on B
    // buyYesOnA=false: Buy NO on A, Buy YES on B
    const priceA = Number(opportunity.yesPriceA) / 1e18;
    const priceB = Number(opportunity.noPriceB) / 1e18;

    const legAParams: PlaceOrderParams = {
      tokenId: opportunity.buyYesOnA ? metaA.yesTokenId : metaA.noTokenId,
      side: "BUY",
      price: priceA,
      size: sizeUsdt,
    };

    const legBParams: PlaceOrderParams = {
      tokenId: opportunity.buyYesOnA ? metaB.noTokenId : metaB.yesTokenId,
      side: "BUY",
      price: priceB,
      size: sizeUsdt,
    };

    log.info("Executing arb (CLOB mode)", {
      protocolA: opportunity.protocolA,
      protocolB: opportunity.protocolB,
      spreadBps: opportunity.spreadBps,
      sizeUsdt,
      legA: legAParams,
      legB: legBParams,
    });

    // Place both legs near-simultaneously
    const [resultA, resultB] = await Promise.all([
      clientA.placeOrder(legAParams),
      clientB.placeOrder(legBParams),
    ]);

    const legA: ClobLeg = {
      platform: opportunity.protocolA,
      orderId: resultA.orderId ?? "",
      tokenId: legAParams.tokenId,
      side: "BUY",
      price: priceA,
      size: sizeUsdt,
      filled: false,
      filledSize: 0,
    };

    const legB: ClobLeg = {
      platform: opportunity.protocolB,
      orderId: resultB.orderId ?? "",
      tokenId: legBParams.tokenId,
      side: "BUY",
      price: priceB,
      size: sizeUsdt,
      filled: false,
      filledSize: 0,
    };

    if (!resultA.success && !resultB.success) {
      log.error("Both CLOB legs failed", { errorA: resultA.error, errorB: resultB.error });
      return;
    }

    if (!resultA.success) {
      log.error("CLOB leg A failed, cancelling leg B", { error: resultA.error });
      if (resultB.orderId) await clientB.cancelOrder(resultB.orderId, legBParams.tokenId);
      return;
    }

    if (!resultB.success) {
      log.error("CLOB leg B failed, cancelling leg A", { error: resultB.error });
      if (resultA.orderId) await clientA.cancelOrder(resultA.orderId, legAParams.tokenId);
      return;
    }

    const position: ClobPosition = {
      id: `clob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      marketId: opportunity.marketId,
      status: "OPEN",
      legA,
      legB,
      totalCost: sizeUsdt * 2,
      expectedPayout: sizeUsdt * 2 * (1 + opportunity.spreadBps / 10000),
      spreadBps: opportunity.spreadBps,
      openedAt: Date.now(),
    };

    log.info("CLOB position opened", {
      id: position.id,
      orderIdA: resultA.orderId,
      orderIdB: resultB.orderId,
      dryRun: this.config.dryRun,
    });

    // In dry-run mode, skip polling and mark as filled immediately
    if (this.config.dryRun) {
      position.status = "FILLED";
      position.legA.filled = true;
      position.legB.filled = true;
      log.info("DRY RUN: position marked FILLED (no real orders placed)");
      return position;
    }

    return this.pollForFills(position);
  }

  async pollForFills(position: ClobPosition): Promise<ClobPosition> {
    const clientA = this.getClobClient(position.legA.platform);
    const clientB = this.getClobClient(position.legB.platform);

    if (!clientA || !clientB) {
      log.warn("Cannot poll fills — missing CLOB client", {
        platformA: position.legA.platform,
        platformB: position.legB.platform,
      });
      return position;
    }

    const intervalMs = this.config.fillPollIntervalMs;
    const timeoutMs = this.config.fillPollTimeoutMs;
    const deadline = Date.now() + timeoutMs;

    log.info("Polling for fills", {
      positionId: position.id,
      orderIdA: position.legA.orderId,
      orderIdB: position.legB.orderId,
      intervalMs,
      timeoutMs,
    });

    const isFinal = (s: OrderStatus) =>
      s === "FILLED" || s === "CANCELLED" || s === "EXPIRED";

    while (Date.now() < deadline) {
      const [statusA, statusB] = await Promise.all([
        clientA.getOrderStatus(position.legA.orderId),
        clientB.getOrderStatus(position.legB.orderId),
      ]);

      position.legA.filledSize = statusA.filledSize;
      position.legB.filledSize = statusB.filledSize;
      position.legA.filled = statusA.status === "FILLED";
      position.legB.filled = statusB.status === "FILLED";

      log.info("Fill poll status", {
        positionId: position.id,
        statusA: statusA.status,
        statusB: statusB.status,
        filledA: statusA.filledSize,
        filledB: statusB.filledSize,
      });

      // Both filled
      if (statusA.status === "FILLED" && statusB.status === "FILLED") {
        position.status = "FILLED";
        log.info("Both legs filled", { positionId: position.id });
        return position;
      }

      // Both dead (cancelled/expired)
      if (isFinal(statusA.status) && isFinal(statusB.status) &&
          statusA.status !== "FILLED" && statusB.status !== "FILLED") {
        position.status = "EXPIRED";
        log.info("Both legs cancelled/expired", { positionId: position.id });
        return position;
      }

      // One filled, other dead — CRITICAL partial fill
      if (statusA.status === "FILLED" && isFinal(statusB.status) && statusB.status !== "FILLED") {
        position.status = "PARTIAL";
        this.paused = true;
        log.error("CRITICAL: Leg A filled but leg B dead — naked exposure, agent paused", {
          positionId: position.id,
          statusA: statusA.status,
          statusB: statusB.status,
        });
        await this.attemptUnwind(clientA, position.legA);
        return position;
      }
      if (statusB.status === "FILLED" && isFinal(statusA.status) && statusA.status !== "FILLED") {
        position.status = "PARTIAL";
        this.paused = true;
        log.error("CRITICAL: Leg B filled but leg A dead — naked exposure, agent paused", {
          positionId: position.id,
          statusA: statusA.status,
          statusB: statusB.status,
        });
        await this.attemptUnwind(clientB, position.legB);
        return position;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    // Timeout — cancel unfilled legs
    log.warn("Fill poll timeout", { positionId: position.id });

    const [finalA, finalB] = await Promise.all([
      clientA.getOrderStatus(position.legA.orderId),
      clientB.getOrderStatus(position.legB.orderId),
    ]);

    const aFilled = finalA.status === "FILLED";
    const bFilled = finalB.status === "FILLED";

    if (!aFilled && !bFilled) {
      // Cancel both
      await Promise.all([
        clientA.cancelOrder(position.legA.orderId, position.legA.tokenId),
        clientB.cancelOrder(position.legB.orderId, position.legB.tokenId),
      ]);
      position.status = "EXPIRED";
      log.info("Timeout: cancelled both unfilled legs", { positionId: position.id });
      return position;
    }

    if (aFilled && !bFilled) {
      await clientB.cancelOrder(position.legB.orderId, position.legB.tokenId);
      position.legA.filled = true;
      position.legA.filledSize = finalA.filledSize;
      position.status = "PARTIAL";
      this.paused = true;
      log.error("CRITICAL: Timeout — leg A filled, cancelled leg B — naked exposure, agent paused", {
        positionId: position.id,
      });
      await this.attemptUnwind(clientA, position.legA);
      return position;
    }

    if (bFilled && !aFilled) {
      await clientA.cancelOrder(position.legA.orderId, position.legA.tokenId);
      position.legB.filled = true;
      position.legB.filledSize = finalB.filledSize;
      position.status = "PARTIAL";
      this.paused = true;
      log.error("CRITICAL: Timeout — leg B filled, cancelled leg A — naked exposure, agent paused", {
        positionId: position.id,
      });
      await this.attemptUnwind(clientB, position.legB);
      return position;
    }

    // Both filled at timeout check
    position.legA.filled = true;
    position.legB.filled = true;
    position.legA.filledSize = finalA.filledSize;
    position.legB.filledSize = finalB.filledSize;
    position.status = "FILLED";
    log.info("Both legs filled at timeout check", { positionId: position.id });
    return position;
  }

  private async attemptUnwind(client: ClobClient, leg: ClobLeg): Promise<void> {
    const size = leg.filledSize > 0 ? leg.filledSize : leg.size;
    const price = Math.round(leg.price * 0.95 * 100) / 100; // 5% discount, round to 2 decimals

    log.info("Attempting to unwind filled leg", {
      platform: leg.platform,
      tokenId: leg.tokenId,
      side: "SELL",
      price,
      size,
    });

    try {
      const result = await client.placeOrder({
        tokenId: leg.tokenId,
        side: "SELL",
        price,
        size,
      });

      if (result.success) {
        log.info("Unwind order placed", {
          orderId: result.orderId,
          platform: leg.platform,
          tokenId: leg.tokenId,
          price,
          size,
        });
      } else {
        log.warn("Unwind order rejected", {
          platform: leg.platform,
          tokenId: leg.tokenId,
          error: result.error,
        });
      }
    } catch (err) {
      log.warn("Unwind failed", {
        platform: leg.platform,
        tokenId: leg.tokenId,
        error: String(err),
      });
    }
  }

  private getClobClient(protocol: string): ClobClient | undefined {
    const name = protocol.toLowerCase();
    if (name === "probable") return this.clobClients.probable;
    if (name === "predict") return this.clobClients.predict;
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Close resolved (vault mode only)
  // ---------------------------------------------------------------------------

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
          const payout = await this.vaultClient!.closePosition(pos.positionId, 0n);
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

  // ---------------------------------------------------------------------------
  // Close resolved (CLOB mode — CTF redemption)
  // ---------------------------------------------------------------------------

  async closeResolvedClob(positions: ClobPosition[]): Promise<number> {
    let closed = 0;

    for (const pos of positions) {
      if (pos.status === "CLOSED" || pos.status === "EXPIRED") continue;
      if (pos.status !== "FILLED") continue; // Only redeem filled positions

      try {
        // Get conditionId from market metadata
        const metaA = this.metaResolvers.get(pos.legA.platform)?.getMarketMeta(pos.marketId);
        const metaB = this.metaResolvers.get(pos.legB.platform)?.getMarketMeta(pos.marketId);

        if (!metaA && !metaB) {
          log.warn("Cannot resolve conditionId for CLOB redemption", { positionId: pos.id });
          continue;
        }

        // Check resolution on both platforms
        let resolved = false;
        const conditionId = (metaA?.conditionId ?? metaB?.conditionId) as `0x${string}`;

        for (const platform of [pos.legA.platform, pos.legB.platform]) {
          const ctfAddress = CTF_ADDRESSES[platform.toLowerCase()];
          if (!ctfAddress) continue;

          try {
            const denom = await this.publicClient.readContract({
              address: ctfAddress,
              abi: payoutDenominatorAbi,
              functionName: "payoutDenominator",
              args: [conditionId],
            });
            if (denom > 0n) {
              resolved = true;
              break;
            }
          } catch {
            // May fail if conditionId differs between platforms
          }
        }

        if (!resolved) continue;

        log.info("CLOB position market resolved, attempting redemption", {
          positionId: pos.id,
          conditionId,
        });

        if (!this.walletClient) {
          log.warn("Cannot redeem — no walletClient on executor");
          continue;
        }

        const account = this.walletClient.account;
        if (!account) continue;

        // Redeem on each platform where we hold tokens
        for (const leg of [pos.legA, pos.legB]) {
          const ctfAddress = CTF_ADDRESSES[leg.platform.toLowerCase()];
          if (!ctfAddress) continue;

          // Check if we hold any tokens
          const balance = await this.publicClient.readContract({
            address: ctfAddress,
            abi: balanceOfAbi,
            functionName: "balanceOf",
            args: [account.address, BigInt(leg.tokenId)],
          });

          if (balance === 0n) {
            log.info("No tokens to redeem", { platform: leg.platform, tokenId: leg.tokenId });
            continue;
          }

          // Determine indexSet from tokenId
          // YES tokens have indexSet=1 (0b01), NO tokens have indexSet=2 (0b10)
          const meta = this.metaResolvers.get(leg.platform)?.getMarketMeta(pos.marketId);
          const isYes = meta ? leg.tokenId === meta.yesTokenId : true;
          const indexSets = isYes ? [1n] : [2n];

          try {
            const hash = await this.walletClient.writeContract({
              account,
              address: ctfAddress,
              abi: redeemPositionsAbi,
              functionName: "redeemPositions",
              args: [
                BSC_USDT,
                "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
                conditionId,
                indexSets,
              ],
              chain: this.walletClient.chain,
            });
            log.info("CTF tokens redeemed", {
              platform: leg.platform,
              tokenId: leg.tokenId,
              txHash: hash,
            });
          } catch (err) {
            log.error("CTF redemption failed", {
              platform: leg.platform,
              tokenId: leg.tokenId,
              error: String(err),
            });
          }
        }

        pos.status = "CLOSED";
        pos.closedAt = Date.now();
        closed++;
        log.info("CLOB position closed", { positionId: pos.id });
      } catch (err) {
        log.error("Error checking CLOB position resolution", {
          positionId: pos.id,
          error: String(err),
        });
      }
    }

    return closed;
  }
}
