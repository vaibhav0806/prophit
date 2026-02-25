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

const UNWIND_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const UNWIND_POLL_INTERVAL_MS = 10_000; // 10 seconds

interface ClobClients {
  probable?: ClobClient;
  predict?: ClobClient;
  probableProxyAddress?: `0x${string}`;
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
  private minTradeSize: bigint | undefined;
  private paused = false;
  private consecutiveVerificationFailures = 0;
  private static readonly MAX_VERIFICATION_FAILURES = 2;

  constructor(
    vaultClient: VaultClient | undefined,
    config: Config,
    publicClient: PublicClient,
    clobClients?: ClobClients,
    metaResolvers?: Map<string, MarketMetaResolver>,
    walletClient?: WalletClient,
    minTradeSize?: bigint,
  ) {
    this.vaultClient = vaultClient ?? null;
    this.config = config;
    this.publicClient = publicClient;
    this.clobClients = clobClients ?? {};
    this.metaResolvers = metaResolvers ?? new Map();
    this.walletClient = walletClient ?? null;
    this.minTradeSize = minTradeSize;
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

    // Log market mapping for audit trail — helps detect false-positive matches
    log.info("Market mapping resolved", {
      marketId: opportunity.marketId,
      protocolA: opportunity.protocolA,
      protocolB: opportunity.protocolB,
      conditionIdA: metaA.conditionId,
      conditionIdB: metaB.conditionId,
      tokenA: opportunity.buyYesOnA ? metaA.yesTokenId : metaA.noTokenId,
      tokenB: opportunity.buyYesOnA ? metaB.noTokenId : metaB.yesTokenId,
    });

    // Calculate size: cap to liquidity (90%)
    const SCALE = 1_000_000n;
    let sizeUsdt = Number(maxPositionSize / 2n) / 1_000_000; // Convert 6-dec to human

    const liqA = Number(opportunity.liquidityA) / 1_000_000;
    const liqB = Number(opportunity.liquidityB) / 1_000_000;

    if (liqA > 0 && liqA * 0.9 < sizeUsdt) sizeUsdt = liqA * 0.9;
    if (liqB > 0 && liqB * 0.9 < sizeUsdt) sizeUsdt = liqB * 0.9;

    // Enforce minimum trade size
    const minSizeUsdt = this.minTradeSize ? Number(this.minTradeSize) / 1_000_000 : 1;
    if (sizeUsdt < minSizeUsdt) {
      log.info("CLOB: position size below minimum trade size", { sizeUsdt, minSizeUsdt });
      return;
    }

    // Pre-check USDT balance (EOA covers Predict leg; Safe covers Probable leg when configured)
    const account = this.walletClient?.account;
    if (account && !this.config.dryRun) {
      try {
        const usdtBalance = await this.publicClient.readContract({
          address: BSC_USDT,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [account.address],
        });
        // When Safe is configured, EOA only needs to cover the non-Probable leg
        const eoaLegs = this.clobClients.probableProxyAddress ? 1 : 2;
        const requiredWei = BigInt(Math.round(sizeUsdt * eoaLegs * 1e6)) * 10n ** 12n;
        if (usdtBalance < requiredWei) {
          // Cap size to EOA balance instead of skipping entirely
          // Floor to 8dp to prevent Math.round(x*1e8) in signing.ts from rounding past actual balance
          const eoaUsdt = Math.floor(Number(usdtBalance) / 1e18 * 1e8) / 1e8 / eoaLegs;
          if (eoaUsdt >= minSizeUsdt) {
            log.info("CLOB: capping trade size to EOA balance", {
              original: sizeUsdt,
              capped: eoaUsdt,
            });
            sizeUsdt = eoaUsdt;
          } else {
            log.warn("CLOB: insufficient EOA USDT balance, skipping", {
              balance: Number(usdtBalance) / 1e18,
              required: sizeUsdt * eoaLegs,
            });
            return;
          }
        }
      } catch (err) {
        log.warn("CLOB: failed to check USDT balance, proceeding anyway", { error: String(err) });
      }
    }

    // Safe USDT balance pre-check (for Probable leg)
    const proxyAddr = this.clobClients.probableProxyAddress;
    if (proxyAddr && !this.config.dryRun &&
        (opportunity.protocolA.toLowerCase() === "probable" || opportunity.protocolB.toLowerCase() === "probable")) {
      try {
        const safeBalance = await this.publicClient.readContract({
          address: BSC_USDT,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [proxyAddr],
        });
        const requiredWei = BigInt(Math.round(sizeUsdt * 1.0175 * 1e6)) * 10n ** 12n;
        if (safeBalance < requiredWei) {
          // Cap size to Safe balance instead of skipping entirely
          // Floor to 8dp to prevent Math.round(x*1e8) in signing.ts from rounding past actual balance
          const safeUsdt = Math.floor(Number(safeBalance) / 1e18 * 1e8) / 1e8;
          if (safeUsdt >= minSizeUsdt) {
            log.info("CLOB: capping trade size to Safe balance for Probable leg", {
              safe: proxyAddr,
              original: sizeUsdt,
              capped: safeUsdt,
            });
            sizeUsdt = safeUsdt;
          } else {
            log.warn("CLOB: Safe USDT balance insufficient for Probable leg, skipping", {
              safe: proxyAddr,
              balance: safeUsdt,
              required: sizeUsdt,
            });
            return;
          }
        }
      } catch (err) {
        log.warn("CLOB: failed to check Safe USDT balance, proceeding anyway", { error: String(err) });
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
      ...(metaA.predictMarketId ? { marketId: metaA.predictMarketId } : {}),
    };

    const legBParams: PlaceOrderParams = {
      tokenId: opportunity.buyYesOnA ? metaB.noTokenId : metaB.yesTokenId,
      side: "BUY",
      price: priceB,
      size: sizeUsdt,
      ...(metaB.predictMarketId ? { marketId: metaB.predictMarketId } : {}),
    };

    log.info("Executing arb (CLOB mode)", {
      protocolA: opportunity.protocolA,
      protocolB: opportunity.protocolB,
      spreadBps: opportunity.spreadBps,
      sizeUsdt,
      legA: legAParams,
      legB: legBParams,
    });

    // Snapshot balances before order placement for post-fill verification
    let preTradeEoaBalance = 0n;
    let preTradeSafeBalance = 0n;
    try {
      if (account) {
        preTradeEoaBalance = await this.publicClient.readContract({
          address: BSC_USDT, abi: erc20BalanceOfAbi, functionName: "balanceOf",
          args: [account.address],
        });
      }
      if (proxyAddr) {
        preTradeSafeBalance = await this.publicClient.readContract({
          address: BSC_USDT, abi: erc20BalanceOfAbi, functionName: "balanceOf",
          args: [proxyAddr],
        });
      }
    } catch {
      // Non-critical — verification will be skipped
    }

    // ---------------------------------------------------------------------------
    // Sequential execution: Predict first, then Probable only if Predict fills.
    // Predict FOK orders frequently don't fill (low liquidity / stale quotes).
    // Placing both simultaneously caused systematic losses: Probable fills,
    // Predict doesn't, unwind sells Probable at a loss.
    // ---------------------------------------------------------------------------

    const predictIsA = opportunity.protocolA.toLowerCase() === "predict";
    const predictClient = predictIsA ? clientA : clientB;
    const probableClient = predictIsA ? clientB : clientA;
    const predictParams = predictIsA ? legAParams : legBParams;
    const probableParams = predictIsA ? legBParams : legAParams;
    const predictMeta = predictIsA ? metaA : metaB;
    const probableMeta = predictIsA ? metaB : metaA;

    const isFilledStatus = (s?: string) => {
      const u = s?.toUpperCase();
      return u === "FILLED" || u === "MATCHED" || u === "DRY_RUN" || u === "DRY-RUN";
    };

    // Minimum threshold: 10% of expected leg cost (catches partial fills too)
    const legMinSpend = BigInt(Math.round(sizeUsdt * 0.1 * 1e6)) * 10n ** 12n;

    // --- Step 1: Place Predict order (the unreliable leg) ---
    const predictResult = await predictClient.placeOrder(predictParams);

    if (!predictResult.success) {
      log.error("Predict order failed, skipping Probable leg", { error: predictResult.error });
      return;
    }

    // In dry-run mode, skip balance verification — place both legs immediately
    if (this.config.dryRun) {
      const probableResult = await probableClient.placeOrder(probableParams);
      if (!probableResult.success) {
        log.error("DRY RUN: Probable order failed", { error: probableResult.error });
        return;
      }
      const position: ClobPosition = {
        id: `clob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        marketId: opportunity.marketId,
        status: "FILLED",
        legA: {
          platform: opportunity.protocolA,
          orderId: (predictIsA ? predictResult.orderId : probableResult.orderId) ?? "",
          tokenId: legAParams.tokenId,
          side: "BUY", price: priceA, size: sizeUsdt, filled: true, filledSize: sizeUsdt,
          ...(metaA.predictMarketId ? { marketId: metaA.predictMarketId } : {}),
        },
        legB: {
          platform: opportunity.protocolB,
          orderId: (predictIsA ? probableResult.orderId : predictResult.orderId) ?? "",
          tokenId: legBParams.tokenId,
          side: "BUY", price: priceB, size: sizeUsdt, filled: true, filledSize: sizeUsdt,
          ...(metaB.predictMarketId ? { marketId: metaB.predictMarketId } : {}),
        },
        totalCost: sizeUsdt * 2,
        expectedPayout: sizeUsdt * 2 * (1 + opportunity.spreadBps / 10000),
        spreadBps: opportunity.spreadBps,
        openedAt: Date.now(),
      };
      log.info("DRY RUN: position marked FILLED (no real orders placed)");
      return position;
    }

    log.info("Predict order placed, waiting for fill", {
      orderId: predictResult.orderId,
      price: predictParams.price,
      size: predictParams.size,
    });

    // --- Step 2: Wait and verify Predict fill via balance ---
    await new Promise((r) => setTimeout(r, 3000));

    let predictFilled = false;
    if (preTradeEoaBalance > 0n && account) {
      try {
        const postEoa = await this.publicClient.readContract({
          address: BSC_USDT, abi: erc20BalanceOfAbi, functionName: "balanceOf",
          args: [account.address],
        });
        const eoaSpent = preTradeEoaBalance > postEoa ? preTradeEoaBalance - postEoa : 0n;
        predictFilled = eoaSpent > legMinSpend;
        log.info("Predict fill check", {
          eoaSpent: Number(eoaSpent) / 1e18,
          predictFilled,
          threshold: Number(legMinSpend) / 1e18,
        });
      } catch (err) {
        log.warn("Failed to check Predict fill via balance", { error: String(err) });
      }
    }

    if (!predictFilled) {
      log.info("Predict order did not fill (FOK cancelled), skipping Probable leg", {
        orderId: predictResult.orderId,
        price: predictParams.price,
      });

      // Build minimal position for tracking
      const position: ClobPosition = {
        id: `clob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        marketId: opportunity.marketId,
        status: "EXPIRED",
        legA: {
          platform: opportunity.protocolA,
          orderId: predictIsA ? (predictResult.orderId ?? "") : "",
          tokenId: legAParams.tokenId,
          side: "BUY", price: priceA, size: sizeUsdt, filled: false, filledSize: 0,
          ...(metaA.predictMarketId ? { marketId: metaA.predictMarketId } : {}),
        },
        legB: {
          platform: opportunity.protocolB,
          orderId: predictIsA ? "" : (predictResult.orderId ?? ""),
          tokenId: legBParams.tokenId,
          side: "BUY", price: priceB, size: sizeUsdt, filled: false, filledSize: 0,
          ...(metaB.predictMarketId ? { marketId: metaB.predictMarketId } : {}),
        },
        totalCost: 0,
        expectedPayout: 0,
        spreadBps: opportunity.spreadBps,
        openedAt: Date.now(),
      };
      return position;
    }

    // --- Step 3: Predict filled! Now place Probable leg ---
    log.info("Predict leg FILLED — placing Probable leg", {
      predictOrderId: predictResult.orderId,
    });

    const probableResult = await probableClient.placeOrder(probableParams);

    const legA: ClobLeg = {
      platform: opportunity.protocolA,
      orderId: (predictIsA ? predictResult.orderId : probableResult.orderId) ?? "",
      tokenId: legAParams.tokenId,
      side: "BUY",
      price: priceA,
      size: sizeUsdt,
      filled: predictIsA ? true : isFilledStatus(probableResult.status),
      filledSize: predictIsA ? sizeUsdt : (isFilledStatus(probableResult.status) ? sizeUsdt : 0),
      ...(metaA.predictMarketId ? { marketId: metaA.predictMarketId } : {}),
    };

    const legB: ClobLeg = {
      platform: opportunity.protocolB,
      orderId: (predictIsA ? probableResult.orderId : predictResult.orderId) ?? "",
      tokenId: legBParams.tokenId,
      side: "BUY",
      price: priceB,
      size: sizeUsdt,
      filled: predictIsA ? isFilledStatus(probableResult.status) : true,
      filledSize: predictIsA ? (isFilledStatus(probableResult.status) ? sizeUsdt : 0) : sizeUsdt,
      ...(metaB.predictMarketId ? { marketId: metaB.predictMarketId } : {}),
    };

    if (!probableResult.success) {
      log.error("Probable order failed after Predict fill — naked Predict exposure!", {
        error: probableResult.error,
        predictOrderId: predictResult.orderId,
      });

      const position: ClobPosition = {
        id: `clob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        marketId: opportunity.marketId,
        status: "PARTIAL",
        legA, legB,
        totalCost: sizeUsdt,
        expectedPayout: sizeUsdt * 2 * (1 + opportunity.spreadBps / 10000),
        spreadBps: opportunity.spreadBps,
        openedAt: Date.now(),
      };

      // Pause and attempt unwind of Predict leg
      this.paused = true;
      const predictLeg = predictIsA ? position.legA : position.legB;
      await this.attemptUnwind(predictClient, predictLeg);
      return position;
    }

    const position: ClobPosition = {
      id: `clob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      marketId: opportunity.marketId,
      status: "OPEN",
      legA, legB,
      totalCost: sizeUsdt * 2,
      expectedPayout: sizeUsdt * 2 * (1 + opportunity.spreadBps / 10000),
      spreadBps: opportunity.spreadBps,
      openedAt: Date.now(),
    };

    log.info("CLOB position opened", {
      id: position.id,
      predictOrderId: predictResult.orderId,
      probableOrderId: probableResult.orderId,
      dryRun: this.config.dryRun,
    });

    // --- Step 4: Verify Probable fill via balance ---
    await new Promise((r) => setTimeout(r, 3000));

    let probableFilled = false;
    if (preTradeSafeBalance > 0n && proxyAddr) {
      try {
        const postSafe = await this.publicClient.readContract({
          address: BSC_USDT, abi: erc20BalanceOfAbi, functionName: "balanceOf",
          args: [proxyAddr],
        });
        const safeSpent = preTradeSafeBalance > postSafe ? preTradeSafeBalance - postSafe : 0n;
        probableFilled = safeSpent > legMinSpend;
        log.info("Probable fill check", {
          safeSpent: Number(safeSpent) / 1e18,
          probableFilled,
          threshold: Number(legMinSpend) / 1e18,
        });
      } catch (err) {
        log.warn("Failed to check Probable fill via balance, assuming filled (FOK)", { error: String(err) });
        probableFilled = true; // FOK orders: if placed successfully, likely filled
      }
    } else {
      probableFilled = true; // No Safe pre-balance → can't verify, assume filled
    }

    // Update leg status
    if (predictIsA) {
      position.legA.filled = true; // Already confirmed
      position.legB.filled = probableFilled;
    } else {
      position.legA.filled = probableFilled;
      position.legB.filled = true; // Already confirmed
    }

    if (probableFilled) {
      position.status = "FILLED";
      this.consecutiveVerificationFailures = 0;
      log.info("Both legs confirmed filled", { positionId: position.id });
    } else {
      // Predict filled but Probable didn't — rare with FOK
      position.status = "PARTIAL";
      this.paused = true;
      log.error("PARTIAL FILL: Predict filled but Probable FOK did not — executor paused", {
        positionId: position.id,
      });

      // Attempt to unwind Predict leg
      const predictLeg = predictIsA ? position.legA : position.legB;
      await this.attemptUnwind(predictClient, predictLeg);
    }

    return position;
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
    const discounts = [0.05, 0.10, 0.20]; // progressively more aggressive
    let anyPlaced = false; // track if any order reached the matching engine

    for (let attempt = 0; attempt < discounts.length; attempt++) {
      const discount = discounts[attempt];
      const price = Math.round(leg.price * (1 - discount) * 1000) / 1000; // 3dp — Predict max precision

      log.info("Attempting to unwind filled leg", {
        platform: leg.platform, tokenId: leg.tokenId, side: "SELL", price, size,
        attempt: attempt + 1, maxAttempts: discounts.length,
      });

      try {
        const result = await client.placeOrder({
          tokenId: leg.tokenId, side: "SELL", price, size,
          ...(leg.marketId ? { marketId: leg.marketId } : {}),
          strategy: "LIMIT", // GTC LIMIT for unwinds — sits on the book instead of dying instantly
          isFillOrKill: false,
        });

        if (!result.success || !result.orderId) {
          log.error("Unwind order rejected", { platform: leg.platform, error: result.error, attempt: attempt + 1 });
          continue; // try next discount
        }

        anyPlaced = true;
        log.info("Unwind order placed, monitoring for fill", { orderId: result.orderId, attempt: attempt + 1 });

        // Poll for unwind order fill
        const deadline = Date.now() + UNWIND_POLL_TIMEOUT_MS;
        let filled = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, UNWIND_POLL_INTERVAL_MS));
          try {
            const status = await client.getOrderStatus(result.orderId);
            if (status.status === "FILLED") {
              log.info("Unwind order filled — auto-unpausing executor", {
                orderId: result.orderId, platform: leg.platform, filledSize: status.filledSize,
              });
              this.paused = false;
              return;
            }
            if (status.status === "CANCELLED" || status.status === "EXPIRED") {
              log.warn("Unwind order cancelled/expired, will retry with deeper discount", {
                orderId: result.orderId, status: status.status, attempt: attempt + 1,
              });
              break; // break inner poll loop, try next discount
            }
          } catch (pollErr) {
            log.warn("Unwind poll error, will retry", { error: String(pollErr) });
          }
        }

        if (!filled) {
          log.warn("Unwind attempt did not fill", { attempt: attempt + 1, price });
        }
      } catch (err) {
        log.error("Unwind attempt failed", {
          platform: leg.platform, tokenId: leg.tokenId, error: String(err), attempt: attempt + 1,
        });
      }
    }

    // Distinguish systematic errors (all orders rejected at API level = code bug)
    // from transient failures (orders placed but didn't fill = liquidity/timing).
    // Only auto-unpause on transient failures to prevent compounding losses.
    if (anyPlaced) {
      log.error("All unwind attempts exhausted (transient) — auto-unpausing executor. Manual review recommended.", {
        platform: leg.platform, tokenId: leg.tokenId, size,
      });
      this.paused = false;
    } else {
      log.error("All unwind orders rejected (systematic) — executor stays paused. Manual intervention required.", {
        platform: leg.platform, tokenId: leg.tokenId, size,
      });
      // this.paused remains true — don't auto-unpause on systematic bugs
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
