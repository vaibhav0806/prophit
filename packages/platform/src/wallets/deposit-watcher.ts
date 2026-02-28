import { createPublicClient, http, defineChain, formatUnits } from "viem";
import type { Database } from "@prophet/shared/db";
import { tradingWallets, deposits } from "@prophet/shared/db";

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

export class DepositWatcher {
  private readonly db: Database;
  private readonly publicClient: ReturnType<typeof createPublicClient>;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  // Track last known balances to detect deltas
  private lastKnownBalances = new Map<string, { usdt: bigint; bnb: bigint }>();

  constructor(params: {
    db: Database;
    rpcUrl: string;
    chainId: number;
    pollIntervalMs?: number;
  }) {
    this.db = params.db;
    this.pollIntervalMs = params.pollIntervalMs ?? 30_000; // 30s default

    const chain = defineChain({
      id: params.chainId,
      name: params.chainId === 56 ? "BNB Smart Chain" : "prophet-chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: { default: { http: [params.rpcUrl] } },
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(params.rpcUrl, { timeout: 10_000 }),
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[DepositWatcher] Started");
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[DepositWatcher] Stopped");
  }

  /**
   * Get current balances for a specific wallet address.
   */
  async getBalances(address: string): Promise<{ usdtBalance: bigint; bnbBalance: bigint }> {
    const [usdtBalance, bnbBalance] = await Promise.all([
      this.publicClient.readContract({
        address: BSC_USDT,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }),
      this.publicClient.getBalance({ address: address as `0x${string}` }),
    ]);
    return { usdtBalance, bnbBalance };
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      // Get all trading wallets
      const wallets = await this.db.select().from(tradingWallets);

      for (const wallet of wallets) {
        try {
          const { usdtBalance, bnbBalance } = await this.getBalances(wallet.address);
          const lastKnown = this.lastKnownBalances.get(wallet.address);

          // Detect USDT deposit (balance increased)
          if (lastKnown && usdtBalance > lastKnown.usdt) {
            const depositAmount = usdtBalance - lastKnown.usdt;
            const depositId = crypto.randomUUID();
            // Use a synthetic tx hash since we're detecting via balance delta
            const txHash = `deposit-${depositId}`;

            await this.db.insert(deposits).values({
              id: depositId,
              userId: wallet.userId,
              txHash,
              token: "USDT",
              amount: depositAmount.toString(),
            });
            console.log(`[DepositWatcher] USDT deposit detected for user ${wallet.userId}: ${formatUnits(depositAmount, 18)}`);
          }

          // Detect BNB deposit (balance increased)
          if (lastKnown && bnbBalance > lastKnown.bnb) {
            const depositAmount = bnbBalance - lastKnown.bnb;
            const depositId = crypto.randomUUID();
            const txHash = `deposit-${depositId}`;

            await this.db.insert(deposits).values({
              id: depositId,
              userId: wallet.userId,
              txHash,
              token: "BNB",
              amount: depositAmount.toString(),
            });
            console.log(`[DepositWatcher] BNB deposit detected for user ${wallet.userId}: ${formatUnits(depositAmount, 18)}`);
          }

          // Update last known balances
          this.lastKnownBalances.set(wallet.address, { usdt: usdtBalance, bnb: bnbBalance });
        } catch (err) {
          console.error(`[DepositWatcher] Failed to check wallet ${wallet.address}:`, err);
        }
      }
    } catch (err) {
      console.error("[DepositWatcher] Poll error:", err);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.poll(), this.pollIntervalMs);
    }
  }
}
