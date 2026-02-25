import { encodeFunctionData } from "viem";
import type { Database } from "@prophit/shared/db";
import { withdrawals } from "@prophit/shared/db";
import { eq } from "drizzle-orm";
import type { PrivyClient } from "@privy-io/node";
import { authorizationContext } from "../auth/privy.js";
import { getOrCreateWallet } from "./privy-wallet.js";

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

const erc20TransferAbi = [
  {
    type: "function" as const,
    name: "transfer" as const,
    inputs: [
      { name: "to" as const, type: "address" as const },
      { name: "amount" as const, type: "uint256" as const },
    ],
    outputs: [{ name: "" as const, type: "bool" as const }],
    stateMutability: "nonpayable" as const,
  },
] as const;

export class WithdrawalProcessor {
  private readonly db: Database;
  private readonly privyClient: PrivyClient;
  private readonly chainId: number;

  constructor(params: {
    db: Database;
    privyClient: PrivyClient;
    chainId: number;
  }) {
    this.db = params.db;
    this.privyClient = params.privyClient;
    this.chainId = params.chainId;
  }

  async processWithdrawal(withdrawalId: string): Promise<{ txHash: string }> {
    const [withdrawal] = await this.db.select()
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1);

    if (!withdrawal) throw new Error("Withdrawal not found");
    if (withdrawal.status !== "pending") throw new Error(`Withdrawal status is ${withdrawal.status}, expected pending`);

    // Mark as processing
    await this.db.update(withdrawals)
      .set({ status: "processing" })
      .where(eq(withdrawals.id, withdrawalId));

    try {
      // Get user's Privy wallet ID
      const { walletId } = await getOrCreateWallet(withdrawal.userId);
      const caip2 = `eip155:${this.chainId}`;

      let txHash: string;

      if (withdrawal.token === "BNB") {
        const result = await this.privyClient.wallets().ethereum().sendTransaction(walletId, {
          caip2,
          params: {
            transaction: {
              to: withdrawal.toAddress,
              value: `0x${BigInt(withdrawal.amount).toString(16)}`,
            },
          },
          authorization_context: authorizationContext,
        });
        txHash = result.hash;
      } else {
        // USDT ERC-20 transfer
        const data = encodeFunctionData({
          abi: erc20TransferAbi,
          functionName: "transfer",
          args: [withdrawal.toAddress as `0x${string}`, BigInt(withdrawal.amount)],
        });

        const result = await this.privyClient.wallets().ethereum().sendTransaction(walletId, {
          caip2,
          params: {
            transaction: {
              to: BSC_USDT,
              data,
            },
          },
          authorization_context: authorizationContext,
        });
        txHash = result.hash;
      }

      // Mark as confirmed
      await this.db.update(withdrawals)
        .set({ status: "confirmed", txHash, processedAt: new Date() })
        .where(eq(withdrawals.id, withdrawalId));

      console.log(`[Withdrawal] Processed ${withdrawal.token} withdrawal ${withdrawalId}: ${txHash}`);
      return { txHash };
    } catch (err) {
      // Mark as failed
      await this.db.update(withdrawals)
        .set({ status: "failed", processedAt: new Date() })
        .where(eq(withdrawals.id, withdrawalId));

      console.error(`[Withdrawal] Failed to process ${withdrawalId}:`, err);
      throw err;
    }
  }
}
