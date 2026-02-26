import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { AgentInstance } from "@prophit/agent/src/agent-instance.js";
import type { AgentInstanceConfig, QuoteStore } from "@prophit/agent/src/agent-instance.js";
import { Executor } from "@prophit/agent/src/execution/executor.js";
import { ProbableClobClient } from "@prophit/agent/src/clob/probable-client.js";
import { PredictClobClient } from "@prophit/agent/src/clob/predict-client.js";
import type { ClobPosition } from "@prophit/agent/src/types.js";
import type { UserAgentConfig } from "@prophit/shared/types";
import { createPrivyAccount } from "../wallets/privy-account.js";

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

const erc20BalanceOfAbi = [
  {
    type: "function" as const,
    name: "balanceOf" as const,
    inputs: [{ name: "account" as const, type: "address" as const }],
    outputs: [{ name: "" as const, type: "uint256" as const }],
    stateMutability: "view" as const,
  },
] as const;

export interface PlatformConfig {
  rpcUrl: string;
  chainId: number;
  predictApiBase: string;
  predictApiKey: string;
  probableApiBase: string;
  probableExchangeAddress: `0x${string}`;
  predictExchangeAddress: `0x${string}`;
  orderExpirationSec: number;
  dryRun: boolean;
}

interface ManagedAgent {
  userId: string;
  instance: AgentInstance;
  walletId: string;
  walletAddress: `0x${string}`;
}

export class AgentManager {
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly quoteStore: QuoteStore;
  private readonly platformConfig: PlatformConfig;

  constructor(quoteStore: QuoteStore, platformConfig: PlatformConfig) {
    this.quoteStore = quoteStore;
    this.platformConfig = platformConfig;
  }

  async createAgent(params: {
    userId: string;
    walletId: string;
    walletAddress: `0x${string}`;
    config: UserAgentConfig;
    safeProxyAddress?: `0x${string}`;
    onTradeExecuted?: (trade: ClobPosition) => void;
    initialCooldowns?: Map<string, number>;
  }): Promise<AgentInstance> {
    if (this.agents.has(params.userId)) {
      throw new Error(`Agent already exists for user ${params.userId}`);
    }

    const chain = defineChain({
      id: this.platformConfig.chainId,
      name: this.platformConfig.chainId === 56 ? "BNB Smart Chain" : "prophit-chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: { default: { http: [this.platformConfig.rpcUrl] } },
    });

    const account = createPrivyAccount(params.walletId, params.walletAddress);
    const publicClient = createPublicClient({
      chain,
      transport: http(this.platformConfig.rpcUrl, { timeout: 10_000 }),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(this.platformConfig.rpcUrl, { timeout: 10_000 }),
    });

    // Create CLOB clients for this user
    const probableClobClient = new ProbableClobClient({
      walletClient,
      apiBase: this.platformConfig.probableApiBase,
      exchangeAddress: this.platformConfig.probableExchangeAddress,
      chainId: this.platformConfig.chainId,
      expirationSec: this.platformConfig.orderExpirationSec,
      dryRun: this.platformConfig.dryRun,
      proxyAddress: params.safeProxyAddress,
    });

    const predictClobClient = this.platformConfig.predictApiKey
      ? new PredictClobClient({
          walletClient,
          apiBase: this.platformConfig.predictApiBase,
          apiKey: this.platformConfig.predictApiKey,
          exchangeAddress: this.platformConfig.predictExchangeAddress,
          chainId: this.platformConfig.chainId,
          expirationSec: this.platformConfig.orderExpirationSec,
          dryRun: this.platformConfig.dryRun,
        })
      : undefined;

    // Initialize CLOB auth
    const clobInitPromise = (async () => {
      try {
        console.log(`[AgentManager] Step 1: Probable authenticate...`);
        await probableClobClient.authenticate();
        console.log(`[AgentManager] Step 2: Probable fetchNonce...`);
        await probableClobClient.fetchNonce();
        if (predictClobClient) {
          console.log(`[AgentManager] Step 3: Predict authenticate...`);
          await predictClobClient.authenticate();
          console.log(`[AgentManager] Step 4: Predict fetchNonce...`);
          await predictClobClient.fetchNonce();
        }
        console.log(`[AgentManager] Step 5: Probable ensureApprovals...`);
        await probableClobClient.ensureApprovals(publicClient, params.safeProxyAddress ? params.config.maxTradeSize * 1_000_000n : undefined);
        if (predictClobClient) {
          console.log(`[AgentManager] Step 6: Predict ensureApprovals...`);
          await predictClobClient.ensureApprovals(publicClient);
        }
        console.log(`[AgentManager] CLOB clients initialized for user ${params.userId}`);
      } catch (err) {
        console.error(`[AgentManager] CLOB init failed for user ${params.userId}:`, err);
      }
    })();

    const executor = new Executor(
      undefined, // no vault client for SaaS
      {
        executionMode: "clob",
        dryRun: this.platformConfig.dryRun,
        fillPollIntervalMs: 5000,
        fillPollTimeoutMs: 60000,
        gasToUsdtRate: 3000000000n,
        maxOrderRetries: 2,
        orderExpirationSec: this.platformConfig.orderExpirationSec,
      } as any, // Config subset needed by Executor
      publicClient,
      { probable: probableClobClient, predict: predictClobClient, probableProxyAddress: params.safeProxyAddress },
      this.quoteStore.getMetaResolvers(),
      walletClient,
      params.config.minTradeSize * 1_000_000n, // minTradeSize in 6-decimal USDT
      params.initialCooldowns,
    );

    const agentConfig: AgentInstanceConfig = {
      minSpreadBps: params.config.minSpreadBps,
      maxPositionSize: params.config.maxTradeSize * 1_000_000n, // Convert human-readable to 6-decimal USDT
      minTradeSize: params.config.minTradeSize * 1_000_000n, // Convert human-readable to 6-decimal USDT
      scanIntervalMs: 5000,
      executionMode: "clob",
      dailyLossLimit: params.config.dailyLossLimit * 1_000_000n, // Convert human-readable to 6-decimal USDT
      dryRun: this.platformConfig.dryRun,
    };

    // Balance checker for this user's wallet
    const getBalanceForLossCheck = async (): Promise<bigint> => {
      try {
        const usdtBalance = await publicClient.readContract({
          address: BSC_USDT,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [params.walletAddress],
        });
        return usdtBalance / BigInt(1e12); // 18-dec to 6-dec
      } catch {
        return -1n;
      }
    };

    const instance = new AgentInstance({
      userId: params.userId,
      walletClient,
      publicClient,
      config: agentConfig,
      quoteStore: this.quoteStore,
      executor,
      clobClients: {
        probable: probableClobClient,
        predict: predictClobClient,
        probableProxyAddress: params.safeProxyAddress,
      },
      getBalanceForLossCheck,
      clobInitPromise,
      onTradeExecuted: params.onTradeExecuted,
    });

    this.agents.set(params.userId, {
      userId: params.userId,
      instance,
      walletId: params.walletId,
      walletAddress: params.walletAddress,
    });

    return instance;
  }

  startAgent(userId: string): void {
    const managed = this.agents.get(userId);
    if (!managed) throw new Error(`No agent for user ${userId}`);
    managed.instance.start();
  }

  stopAgent(userId: string): void {
    const managed = this.agents.get(userId);
    if (!managed) throw new Error(`No agent for user ${userId}`);
    managed.instance.stop();
  }

  removeAgent(userId: string): void {
    const managed = this.agents.get(userId);
    if (!managed) return;
    managed.instance.stop();
    this.agents.delete(userId);
  }

  getAgent(userId: string): AgentInstance | undefined {
    return this.agents.get(userId)?.instance;
  }

  getActiveCount(): number {
    let count = 0;
    for (const managed of this.agents.values()) {
      if (managed.instance.isRunning()) count++;
    }
    return count;
  }

  getAllUserIds(): string[] {
    return Array.from(this.agents.keys());
  }

  stopAll(): void {
    for (const managed of this.agents.values()) {
      managed.instance.stop();
    }
  }
}
