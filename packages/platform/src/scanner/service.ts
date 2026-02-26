import { PredictProvider } from "@prophit/agent/src/providers/predict-provider.js";
import { ProbableProvider } from "@prophit/agent/src/providers/probable-provider.js";
import { OpinionProvider } from "@prophit/agent/src/providers/opinion-provider.js";
import type { MarketProvider } from "@prophit/agent/src/providers/base.js";
import type { MarketQuote } from "@prophit/agent/src/types.js";
import { runDiscovery } from "@prophit/agent/src/discovery/pipeline.js";
import { QuoteStore } from "./quote-store.js";

const DUMMY_ADAPTER = "0x0000000000000000000000000000000000000001" as `0x${string}`;

export interface ScannerConfig {
  rpcUrl: string;
  chainId: number;
  predictApiBase: string;
  predictApiKey: string;
  probableApiBase: string;
  probableEventsApiBase: string;
  scanIntervalMs: number;
  autoDiscover: boolean;
  disableProbable: boolean;
  opinionApiKey: string;
  opinionApiBase: string;
  opinionAdapterAddress: string;
  opinionTokenMap?: Record<string, { yesTokenId: string; noTokenId: string; topicId: string }>;
}

export class ScannerService {
  private readonly providers: MarketProvider[] = [];
  private readonly quoteStore: QuoteStore;
  private readonly config: ScannerConfig;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(config: ScannerConfig, quoteStore: QuoteStore) {
    this.config = config;
    this.quoteStore = quoteStore;
  }

  async initialize(): Promise<void> {
    let predictMarketMap: Record<string, { predictMarketId: string; yesTokenId: string; noTokenId: string }> = {};
    let probableMarketMap: Record<string, { probableMarketId: string; conditionId: string; yesTokenId: string; noTokenId: string }> = {};

    let opinionMarketMap: Record<string, { opinionMarketId: string; yesTokenId: string; noTokenId: string; topicId: string }> = {};

    // Auto-discovery
    if (this.config.autoDiscover && this.config.predictApiKey) {
      try {
        console.log("[Scanner] Auto-discovery starting...");
        const result = await runDiscovery({
          probableEventsApiBase: this.config.probableEventsApiBase,
          predictApiBase: this.config.predictApiBase,
          predictApiKey: this.config.predictApiKey,
          opinionApiBase: this.config.opinionApiBase || undefined,
          opinionApiKey: this.config.opinionApiKey || undefined,
          disableProbable: this.config.disableProbable,
        });
        predictMarketMap = result.predictMarketMap;
        probableMarketMap = result.probableMarketMap;
        opinionMarketMap = result.opinionMarketMap;
        if (result.titleMap) {
          this.quoteStore.setTitles(new Map(Object.entries(result.titleMap)));
        }
        if (result.linkMap) {
          this.quoteStore.setLinks(new Map(Object.entries(result.linkMap)));
        }
        console.log(`[Scanner] Auto-discovery complete: ${result.matches.length} matches (Probable: ${Object.keys(probableMarketMap).length}, Opinion: ${Object.keys(opinionMarketMap).length})`);
      } catch (err) {
        console.error("[Scanner] Auto-discovery failed:", err);
      }
    }

    // Initialize providers
    if (this.config.predictApiKey && Object.keys(predictMarketMap).length > 0) {
      const marketMap = new Map(Object.entries(predictMarketMap));
      const predictProvider = new PredictProvider(
        DUMMY_ADAPTER,
        this.config.predictApiBase,
        this.config.predictApiKey,
        Object.keys(predictMarketMap).map((k) => k as `0x${string}`),
        marketMap,
      );
      this.providers.push(predictProvider);
      console.log(`[Scanner] Predict provider enabled: ${Object.keys(predictMarketMap).length} markets`);
    }

    if (Object.keys(probableMarketMap).length > 0 && !this.config.disableProbable) {
      const marketMap = new Map(Object.entries(probableMarketMap));
      const probableProvider = new ProbableProvider(
        DUMMY_ADAPTER,
        this.config.probableApiBase,
        Object.keys(probableMarketMap).map((k) => k as `0x${string}`),
        marketMap,
        this.config.probableEventsApiBase,
      );
      this.providers.push(probableProvider);
      console.log(`[Scanner] Probable provider enabled: ${Object.keys(probableMarketMap).length} markets`);
    }

    // Opinion provider — prefer discovered maps, fall back to static OPINION_TOKEN_MAP
    if (this.config.opinionApiKey) {
      let opinionTokenEntries: [string, { yesTokenId: string; noTokenId: string; topicId: string }][] = [];

      if (Object.keys(opinionMarketMap).length > 0) {
        // Use auto-discovered Opinion markets
        opinionTokenEntries = Object.entries(opinionMarketMap).map(([k, v]) => [k, { yesTokenId: v.yesTokenId, noTokenId: v.noTokenId, topicId: v.topicId }]);
      } else if (this.config.opinionTokenMap) {
        // Fallback to static env config
        opinionTokenEntries = Object.entries(this.config.opinionTokenMap);
      }

      if (opinionTokenEntries.length > 0) {
        const tokenMap = new Map(opinionTokenEntries);
        const marketIds = opinionTokenEntries.map(([k]) => k as `0x${string}`);
        const opinionProvider = new OpinionProvider(
          (this.config.opinionAdapterAddress || DUMMY_ADAPTER) as `0x${string}`,
          this.config.opinionApiBase,
          this.config.opinionApiKey,
          marketIds,
          tokenMap,
        );
        this.providers.push(opinionProvider);
        console.log(`[Scanner] Opinion provider enabled: ${opinionTokenEntries.length} markets (${Object.keys(opinionMarketMap).length > 0 ? "discovered" : "static"})`);
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[Scanner] Started");
    this.scan();
  }

  stop(): void {
    this.running = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    console.log("[Scanner] Stopped");
  }

  getQuoteStore(): QuoteStore {
    return this.quoteStore;
  }

  private async scan(): Promise<void> {
    if (!this.running) return;

    try {
      const results = await Promise.allSettled(this.providers.map((p) => p.fetchQuotes()));
      const allQuotes = results
        .filter((r): r is PromiseFulfilledResult<MarketQuote[]> => r.status === "fulfilled")
        .flatMap((r) => r.value);

      const failedProviders = results
        .map((r, i) => r.status === "rejected" ? this.providers[i].name : null)
        .filter(Boolean);

      if (failedProviders.length > 0) {
        console.warn("[Scanner] Failed providers:", failedProviders);
      }

      // Collect metadata resolvers from providers
      const metaResolvers = new Map<string, any>();
      for (const provider of this.providers) {
        if ("getMarketMeta" in provider && typeof (provider as any).getMarketMeta === "function") {
          metaResolvers.set(provider.name, provider);
        }
      }
      this.quoteStore.update(allQuotes, metaResolvers);
      console.log(`[Scanner] Fetched ${allQuotes.length} quotes`);
    } catch (err) {
      console.error("[Scanner] Scan error:", err);
    }

    if (this.running) {
      this.scanTimer = setTimeout(() => this.scan(), this.config.scanIntervalMs);
    }
  }
}
