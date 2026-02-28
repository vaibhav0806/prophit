/**
 * Get full Predict.fun activity details to debug NO_MARKET_MATCH
 * Usage: pnpm --filter platform exec tsx src/scripts/check-predict-activity.ts
 */
import "dotenv/config";
import { createWalletClient, http, defineChain, getAddress } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { createDb } from "@prophet/shared/db";
import { tradingWallets } from "@prophet/shared/db";
import { eq } from "drizzle-orm";

const rpcUrl = process.env.RPC_URL!;
const eoaAddress = "0xdad013d95acb067b2431fde18cbac2bc92ef6b6c" as `0x${string}`;
const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";
const PREDICT_API_BASE = (process.env.PREDICT_API_BASE ?? "").replace(/\/$/, "");
const PREDICT_API_KEY = process.env.PREDICT_API_KEY ?? "";

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
  if (!wallet) { console.error("No wallet found"); process.exit(1); }

  const chain = defineChain({ id: 56, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const account = createPrivyAccount(wallet.privyWalletId, eoaAddress);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  // Auth
  const msgRes = await fetch(`${PREDICT_API_BASE}/v1/auth/message`, { headers: { "x-api-key": PREDICT_API_KEY }, signal: AbortSignal.timeout(10_000) });
  const { data: { message } } = await msgRes.json() as any;
  const signature = await walletClient.signMessage({ account, message });
  const loginRes = await fetch(`${PREDICT_API_BASE}/v1/auth`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-api-key": PREDICT_API_KEY },
    body: JSON.stringify({ signer: getAddress(eoaAddress), message, signature }), signal: AbortSignal.timeout(10_000),
  });
  const loginData = await loginRes.json() as any;
  const jwt = loginData.data?.token ?? loginData.token;

  // Full activity
  const actRes = await fetch(`${PREDICT_API_BASE}/v1/account/activity`, {
    headers: { Authorization: `Bearer ${jwt}`, "x-api-key": PREDICT_API_KEY }, signal: AbortSignal.timeout(10_000),
  });
  const actBody = await actRes.json() as any;
  const activities = actBody.data ?? [];

  console.log(`Found ${activities.length} activities\n`);

  // Show the MATCH_SUCCESS and the recent NO_MARKET_MATCH entries in full
  for (const a of activities.slice(0, 20)) {
    console.log(`--- ${a.name} at ${a.createdAt} ---`);
    console.log(JSON.stringify(a, null, 2));
    console.log();
  }

  process.exit(0);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
