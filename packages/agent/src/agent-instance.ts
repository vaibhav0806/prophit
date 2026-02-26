import type { PublicClient, WalletClient } from "viem";
import type { ArbitOpportunity, MarketQuote, ClobPosition, AgentStatus, Position } from "./types.js";
import type { ClobClient } from "./clob/types.js";
import type { VaultClient } from "./execution/vault-client.js";
import { detectArbitrage } from "./arbitrage/detector.js";
import { MatchingPipeline } from "./matching/index.js";
import { Executor } from "./execution/executor.js";
import { log } from "./logger.js";
import { scorePositions } from "./yield/scorer.js";
import { allocateCapital } from "./yield/allocator.js";
import { checkRotations } from "./yield/rotator.js";
import type { YieldStatus } from "./yield/types.js";

export interface QuoteStore {
  getLatestQuotes(): Promise<MarketQuote[]>;
}

export interface AgentInstanceConfig {
  minSpreadBps: number;
  maxSpreadBps?: number;
  maxPositionSize: bigint;
  minTradeSize?: bigint;
  scanIntervalMs: number;
  executionMode: "vault" | "clob";
  dailyLossLimit: bigint;
  dryRun: boolean;
  yieldRotationEnabled?: boolean;
  gasToUsdtRate?: bigint;
  minYieldImprovementBps?: number;
}

export interface AgentInstanceParams {
  userId: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
  config: AgentInstanceConfig;
  quoteStore?: QuoteStore;
  executor: Executor;
  clobClients?: {
    probable?: ClobClient;
    predict?: ClobClient;
    opinion?: ClobClient;
    probableProxyAddress?: `0x${string}`;
  };
  vaultClient?: VaultClient;
  matchingPipeline?: MatchingPipeline | null;
  onTradeExecuted?: (trade: ClobPosition) => void;
  onStateChanged?: (state: {
    tradesExecuted: number;
    positions: Position[];
    clobPositions: ClobPosition[];
    lastScan: number;
  }) => void;
  /** Callback to collect CLOB nonces for persistence */
  collectClobNonces?: () => Record<string, string> | undefined;
  /** Balance checker for daily loss limit (returns USDT balance in 6 decimals, or -1n on error) */
  getBalanceForLossCheck?: () => Promise<bigint>;
  /** Resolved persisted state to restore from */
  initialState?: {
    tradesExecuted?: number;
    positions?: Position[];
    clobPositions?: ClobPosition[];
    lastScan?: number;
  };
  /** Promise that resolves when CLOB clients are initialized */
  clobInitPromise?: Promise<void>;
}

// --- Dedup prevention ---
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

function opportunityHash(opp: ArbitOpportunity): string {
  return `${opp.marketId}-${opp.protocolA}-${opp.protocolB}-${opp.buyYesOnA}`;
}

// --- Scan timeout helper ---
const SCAN_TIMEOUT_MS = 120_000; // 2 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export class AgentInstance {
  private readonly userId: string;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly executor: Executor;
  private readonly quoteStore?: QuoteStore;
  private readonly vaultClient?: VaultClient;
  private readonly matchingPipeline?: MatchingPipeline | null;
  private readonly clobClients?: {
    probable?: ClobClient;
    predict?: ClobClient;
    opinion?: ClobClient;
    probableProxyAddress?: `0x${string}`;
  };
  private readonly onTradeExecuted?: (trade: ClobPosition) => void;
  private readonly onStateChanged?: (state: {
    tradesExecuted: number;
    positions: Position[];
    clobPositions: ClobPosition[];
    lastScan: number;
  }) => void;
  private readonly collectClobNonces?: () => Record<string, string> | undefined;
  private readonly getBalanceForLossCheck?: () => Promise<bigint>;
  private readonly clobInitPromise?: Promise<void>;

  // Mutable config
  private minSpreadBps: number;
  private maxSpreadBps: number;
  private maxPositionSize: bigint;
  private scanIntervalMs: number;
  private executionMode: "vault" | "clob";
  private dailyLossLimit: bigint;
  private yieldRotationEnabled: boolean;
  private gasToUsdtRate: bigint;
  private minYieldImprovementBps: number;

  // Agent state
  private running = false;
  private scanning = false;
  private lastScan = 0;
  private tradesExecuted = 0;
  private opportunities: ArbitOpportunity[] = [];
  private positions: Position[] = [];
  private clobPositions: ClobPosition[] = [];
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private yieldStatus: YieldStatus | null = null;
  private readonly startedAt: number;

  // Dedup
  private readonly recentTrades = new Map<string, number>();

  // Daily loss tracking
  private dailyStartBalance: bigint | null = null;
  private dailyLossResetAt: number;

  constructor(params: AgentInstanceParams) {
    this.userId = params.userId;
    this.publicClient = params.publicClient;
    this.walletClient = params.walletClient;
    this.executor = params.executor;
    this.quoteStore = params.quoteStore;
    this.vaultClient = params.vaultClient;
    this.matchingPipeline = params.matchingPipeline;
    this.clobClients = params.clobClients;
    this.onTradeExecuted = params.onTradeExecuted;
    this.onStateChanged = params.onStateChanged;
    this.collectClobNonces = params.collectClobNonces;
    this.getBalanceForLossCheck = params.getBalanceForLossCheck;
    this.clobInitPromise = params.clobInitPromise;

    this.minSpreadBps = params.config.minSpreadBps;
    this.maxSpreadBps = params.config.maxSpreadBps ?? 400;
    this.maxPositionSize = params.config.maxPositionSize;
    this.scanIntervalMs = params.config.scanIntervalMs;
    this.executionMode = params.config.executionMode;
    this.dailyLossLimit = params.config.dailyLossLimit;
    this.yieldRotationEnabled = params.config.yieldRotationEnabled ?? false;
    this.gasToUsdtRate = params.config.gasToUsdtRate ?? 3000000000n;
    this.minYieldImprovementBps = params.config.minYieldImprovementBps ?? 200;

    this.startedAt = Date.now();
    this.dailyLossResetAt = Date.now() + 24 * 60 * 60 * 1000;

    // Restore persisted state
    if (params.initialState) {
      this.tradesExecuted = params.initialState.tradesExecuted ?? 0;
      this.positions = params.initialState.positions ?? [];
      this.clobPositions = params.initialState.clobPositions ?? [];
      this.lastScan = params.initialState.lastScan ?? 0;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    log.info("AgentInstance started", { userId: this.userId });
    this.scan();
  }

  stop(): void {
    this.running = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    log.info("AgentInstance stopped", { userId: this.userId });
  }

  getStatus(): AgentStatus {
    return {
      running: this.running,
      lastScan: this.lastScan,
      tradesExecuted: this.tradesExecuted,
      uptime: Date.now() - this.startedAt,
      config: {
        minSpreadBps: this.minSpreadBps,
        maxSpreadBps: this.maxSpreadBps,
        maxPositionSize: this.maxPositionSize.toString(),
        scanIntervalMs: this.scanIntervalMs,
        executionMode: this.executionMode,
      },
    };
  }

  updateConfig(update: {
    minSpreadBps?: number;
    maxSpreadBps?: number;
    maxPositionSize?: string;
    scanIntervalMs?: number;
  }): void {
    if (update.minSpreadBps !== undefined) {
      if (update.minSpreadBps < 1 || update.minSpreadBps > 10000) {
        throw new Error('minSpreadBps must be between 1 and 10000');
      }
      this.minSpreadBps = update.minSpreadBps;
      log.info("Updated minSpreadBps", { minSpreadBps: this.minSpreadBps });
    }
    if (update.maxSpreadBps !== undefined) {
      if (update.maxSpreadBps < 1 || update.maxSpreadBps > 10000) {
        throw new Error('maxSpreadBps must be between 1 and 10000');
      }
      this.maxSpreadBps = update.maxSpreadBps;
      log.info("Updated maxSpreadBps", { maxSpreadBps: this.maxSpreadBps });
    }
    if (update.maxPositionSize !== undefined) {
      const size = BigInt(update.maxPositionSize);
      if (size <= 0n) {
        throw new Error('maxPositionSize must be positive');
      }
      this.maxPositionSize = size;
      log.info("Updated maxPositionSize", { maxPositionSize: this.maxPositionSize.toString() });
    }
    if (update.scanIntervalMs !== undefined) {
      if (update.scanIntervalMs < 1000 || update.scanIntervalMs > 300000) {
        throw new Error('scanIntervalMs must be between 1000 and 300000');
      }
      this.scanIntervalMs = update.scanIntervalMs;
      log.info("Updated scanIntervalMs", { scanIntervalMs: this.scanIntervalMs });
    }
  }

  getOpportunities(): ArbitOpportunity[] {
    return this.opportunities;
  }

  getClobPositions(): ClobPosition[] {
    return this.clobPositions;
  }

  getPositions(): Position[] {
    return this.positions;
  }

  getYieldStatus(): YieldStatus | null {
    return this.yieldStatus;
  }

  isRunning(): boolean {
    return this.running;
  }

  // --- Dedup helpers ---

  private isRecentlyTraded(opp: ArbitOpportunity): boolean {
    const now = Date.now();
    for (const [key, ts] of this.recentTrades) {
      if (now - ts > DEDUP_WINDOW_MS) this.recentTrades.delete(key);
    }
    const hash = opportunityHash(opp);
    const lastTrade = this.recentTrades.get(hash);
    return !!(lastTrade && now - lastTrade < DEDUP_WINDOW_MS);
  }

  private recordTrade(opp: ArbitOpportunity): void {
    this.recentTrades.set(opportunityHash(opp), Date.now());
    for (const [key, ts] of this.recentTrades) {
      if (Date.now() - ts > DEDUP_WINDOW_MS) this.recentTrades.delete(key);
    }
  }

  // --- Daily loss limit ---

  private checkDailyLoss(currentBalance: bigint): boolean {
    if (Date.now() > this.dailyLossResetAt) {
      this.dailyStartBalance = currentBalance;
      this.dailyLossResetAt = Date.now() + 24 * 60 * 60 * 1000;
      log.info("Daily loss counter reset", { balance: currentBalance.toString() });
    }
    if (this.dailyStartBalance === null) {
      this.dailyStartBalance = currentBalance;
    }
    if (this.dailyStartBalance > currentBalance) {
      const loss = this.dailyStartBalance - currentBalance;
      if (loss >= this.dailyLossLimit) return false;
    }
    return true;
  }

  // --- State persistence ---

  private persistState(): void {
    if (this.onStateChanged) {
      this.onStateChanged({
        tradesExecuted: this.tradesExecuted,
        positions: this.positions,
        clobPositions: this.clobPositions,
        lastScan: this.lastScan,
      });
    }
  }

  // --- Scan loop ---

  private async scan(): Promise<void> {
    if (!this.running) return;
    if (this.scanning) return;
    this.scanning = true;

    try {
      if (this.clobInitPromise) await this.clobInitPromise;

      try {
        await withTimeout((async () => {
        log.info("Scanning for opportunities");

        // Fetch quotes
        let allQuotes: MarketQuote[];
        if (this.quoteStore) {
          allQuotes = await this.quoteStore.getLatestQuotes();
          log.info("Fetched quotes from store", { count: allQuotes.length });
        } else {
          // No quote store — this shouldn't happen in practice; the caller
          // should always provide either a quoteStore or providers.
          log.warn("No quoteStore configured, scan has no quotes");
          allQuotes = [];
        }

        // AI semantic matching: discover equivalent events across protocols
        let matchedQuotes: MarketQuote[] = allQuotes;
        if (this.matchingPipeline) {
          try {
            const clusters = await this.matchingPipeline.matchQuotes(allQuotes);
            if (clusters.length > 0) {
              const syntheticQuotes: MarketQuote[] = [];
              for (let ci = 0; ci < clusters.length; ci++) {
                const syntheticId = (`0x${"ee".repeat(31)}${ci.toString(16).padStart(2, "0")}`) as `0x${string}`;
                for (const q of clusters[ci].quotes) {
                  syntheticQuotes.push({ ...q, marketId: syntheticId });
                }
              }
              matchedQuotes = [...allQuotes, ...syntheticQuotes];
              log.info("AI matching found verified clusters", {
                clusterCount: clusters.length,
                syntheticQuotes: syntheticQuotes.length,
              });
            }
          } catch (err) {
            log.error("AI matching failed, falling back to exact-match", { error: String(err) });
          }
        }

        // Detect arbitrage
        const detected = detectArbitrage(matchedQuotes);
        this.opportunities = detected;

        log.info("[DEBUG] Scan results", {
          totalQuotes: matchedQuotes.length,
          detected: detected.length,
          minSpreadBps: this.minSpreadBps,
          maxPositionSize: this.maxPositionSize.toString(),
          executionMode: this.executionMode,
          dryRun: this.executor?.["config"]?.dryRun,
        });

        // Filter by minSpreadBps
        const actionable = detected.filter((o) => o.spreadBps >= this.minSpreadBps && o.spreadBps <= this.maxSpreadBps);
        const fresh = actionable.filter((o) => !this.isRecentlyTraded(o));

        log.info("[DEBUG] Filtering", {
          actionable: actionable.length,
          fresh: fresh.length,
          recentlyTradedCount: actionable.length - fresh.length,
        });

        // Daily loss limit check
        let balanceForLossCheck = 0n;
        if (this.getBalanceForLossCheck) {
          try {
            balanceForLossCheck = await this.getBalanceForLossCheck();
          } catch (err) {
            log.error("Balance check failed — skipping execution this scan", { error: String(err) });
            balanceForLossCheck = -1n;
          }
        } else if (this.vaultClient) {
          try { balanceForLossCheck = await this.vaultClient.getVaultBalance(); } catch { /* vault may not be available */ }
        }
        const withinLossLimit = balanceForLossCheck >= 0n && this.checkDailyLoss(balanceForLossCheck);

        log.info("[DEBUG] Loss limit check", {
          balanceForLossCheck: balanceForLossCheck.toString(),
          withinLossLimit,
          dailyStartBalance: this.dailyStartBalance?.toString(),
          dailyLossLimit: this.dailyLossLimit.toString(),
        });

        if (!withinLossLimit) {
          log.warn("Daily loss limit reached, skipping execution", {
            startBalance: this.dailyStartBalance?.toString(),
            currentBalance: balanceForLossCheck.toString(),
            limit: this.dailyLossLimit.toString(),
          });
        }

        if (fresh.length > 0 && withinLossLimit) {
          log.info("Found opportunities above threshold", {
            count: fresh.length,
            minSpreadBps: this.minSpreadBps,
            bestSpreadBps: fresh[0].spreadBps,
            bestProtocolA: fresh[0].protocolA,
            bestProtocolB: fresh[0].protocolB,
          });

          // LLM risk assessment (if AI matching is enabled)
          let effectiveMaxSize = this.maxPositionSize;
          if (this.matchingPipeline) {
            try {
              const risk = await this.matchingPipeline.assessRisk(fresh[0], allQuotes);
              const sizeMultiplier = BigInt(Math.floor(risk.recommendedSizeMultiplier * 100));
              effectiveMaxSize = (this.maxPositionSize * sizeMultiplier) / 100n;
              log.info("Risk-adjusted position size", {
                riskScore: risk.riskScore,
                multiplier: risk.recommendedSizeMultiplier,
                originalMax: this.maxPositionSize.toString(),
                adjustedMax: effectiveMaxSize.toString(),
                concerns: risk.concerns,
              });
            } catch (err) {
              log.error("Risk assessment failed, using default size", { error: String(err) });
            }
          }

          try {
            log.info("[DEBUG] Calling executor.executeBest", {
              marketId: fresh[0].marketId,
              spreadBps: fresh[0].spreadBps,
              protocolA: fresh[0].protocolA,
              protocolB: fresh[0].protocolB,
              maxSize: effectiveMaxSize.toString(),
            });
            const result = await this.executor.executeBest(fresh[0], effectiveMaxSize);
            log.info("[DEBUG] executor.executeBest returned", {
              hasResult: !!result,
              resultId: result?.id,
              resultStatus: result?.status,
            });
            // Track CLOB positions — only count as trade if BOTH legs confirmed filled
            if (result && this.executionMode === "clob") {
              this.clobPositions.push(result);
              // Always record as recently traded to prevent retrying failed markets
              this.recordTrade(fresh[0]);

              if (result.status === "FILLED" && result.legA.filled && result.legB.filled) {
                this.tradesExecuted++;
                if (this.onTradeExecuted) {
                  this.onTradeExecuted(result);
                }
              } else {
                log.warn("Trade not fully filled — not counting as executed", {
                  positionId: result.id,
                  status: result.status,
                  legAFilled: result.legA.filled,
                  legBFilled: result.legB.filled,
                });
              }
            }
            // Persist immediately after trade
            this.persistState();
          } catch (execErr) {
            log.error("[DEBUG] executor.executeBest threw", { error: String(execErr) });
          }
        } else if (fresh.length === 0) {
          log.info("No opportunities above threshold", { minSpreadBps: this.minSpreadBps });
        }

        // Refresh positions (vault mode only)
        if (this.vaultClient) {
          try {
            this.positions = await this.vaultClient.getAllPositions();
          } catch {
            // Vault may not have positions yet
          }

          // Close resolved positions
          try {
            const closed = await this.executor.closeResolved(this.positions);
            if (closed > 0) {
              log.info("Closed resolved positions", { count: closed });
              this.positions = await this.vaultClient.getAllPositions();
            }
          } catch (err) {
            log.error("Error closing resolved positions", { error: String(err) });
          }
        }

        // Close resolved CLOB positions
        if (this.executionMode === "clob" && this.clobPositions.length > 0) {
          try {
            const closedClob = await this.executor.closeResolvedClob(this.clobPositions);
            if (closedClob > 0) {
              log.info("Closed resolved CLOB positions", { count: closedClob });
            }
          } catch (err) {
            log.error("Error closing resolved CLOB positions", { error: String(err) });
          }
        }

        // --- Yield rotation ---
        if (this.yieldRotationEnabled) {
          try {
            const openPositions = this.positions.filter((p) => !p.closed);
            const scored = scorePositions(openPositions);

            let vaultBalance = 0n;
            if (this.vaultClient) {
              try {
                vaultBalance = await this.vaultClient.getVaultBalance();
              } catch {
                // Vault may not be available
              }
            }

            const allocationPlan = allocateCapital(vaultBalance, this.opportunities, this.maxPositionSize);

            const gasCostEstimate = this.gasToUsdtRate * 400_000n / BigInt(1e18);
            const rotationSuggestions = checkRotations(
              scored,
              this.opportunities,
              gasCostEstimate,
              this.minYieldImprovementBps,
            );

            let totalDeployed = 0n;
            let weightedSum = 0;
            for (const sp of scored) {
              const cost = sp.position.costA + sp.position.costB;
              totalDeployed += cost;
              weightedSum += sp.annualizedYield * Number(cost);
            }
            const weightedAvgYield = totalDeployed > 0n ? weightedSum / Number(totalDeployed) : 0;

            this.yieldStatus = {
              scoredPositions: scored,
              allocationPlan,
              rotationSuggestions,
              totalDeployed: totalDeployed.toString(),
              weightedAvgYield,
            };

            if (rotationSuggestions.length > 0) {
              log.info("Yield rotation suggestions", {
                count: rotationSuggestions.length,
                bestImprovement: rotationSuggestions[0].yieldImprovement,
              });
            }
          } catch (err) {
            log.error("Yield rotation error", { error: String(err) });
          }
        }

        this.lastScan = Date.now();

        // Persist state after successful scan
        this.persistState();
      })(), SCAN_TIMEOUT_MS, "scan");
      } catch (err) {
        log.error("Scan error", { error: String(err) });
      }

      // Schedule next scan
      if (this.running) {
        this.scanTimer = setTimeout(() => this.scan(), this.scanIntervalMs);
      }
    } finally {
      this.scanning = false;
    }
  }
}
