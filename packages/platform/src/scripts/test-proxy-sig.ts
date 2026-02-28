/**
 * Deploy proxy wallet via Probable's factory.
 * Usage: pnpm --filter platform exec tsx src/scripts/test-proxy-sig.ts
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { getOrCreateProbableProxy } from "../wallets/safe-deployer.js";
import { createDb } from "@prophet/shared/db";
import { tradingWallets } from "@prophet/shared/db";
import { eq } from "drizzle-orm";

const rpcUrl = process.env.RPC_URL!;
const chainId = Number(process.env.CHAIN_ID ?? "56");
const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";

const chain = defineChain({
  id: chainId,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

const db = createDb(process.env.DATABASE_URL!);
const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
if (!wallet) { console.error("No wallet found"); process.exit(1); }

const eoaAddress = wallet.address as `0x${string}`;
const account = createPrivyAccount(wallet.privyWalletId, eoaAddress);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });

console.log("EOA:", eoaAddress);

try {
  const proxyAddress = await getOrCreateProbableProxy(walletClient, publicClient, eoaAddress, chain);
  console.log("SUCCESS! Proxy:", proxyAddress);

  await db.update(tradingWallets)
    .set({ safeProxyAddress: proxyAddress })
    .where(eq(tradingWallets.userId, userId));
  console.log("Saved to DB.");
} catch (err: any) {
  console.error("FAILED:", err.shortMessage ?? err.message);
}

process.exit(0);
