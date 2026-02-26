/**
 * Dump full raw Predict position data (for debugging).
 * Usage: pnpm --filter platform exec tsx src/scripts/dump-positions.ts
 */
import "dotenv/config";
import { createWalletClient, http, defineChain, getAddress } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { createDb } from "@prophit/shared/db";
import { tradingWallets } from "@prophit/shared/db";
import { eq } from "drizzle-orm";

const EOA = "0xdad013d95acb067b2431fde18cbac2bc92ef6b6c" as `0x${string}`;
const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";

async function main() {
  const predictBase = (process.env.PREDICT_API_BASE || "").replace(/\/$/, "");
  const predictKey = process.env.PREDICT_API_KEY || "";
  const db = createDb(process.env.DATABASE_URL!);
  const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
  const chain = defineChain({ id: 56, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL!] } } });
  const account = createPrivyAccount(wallet.privyWalletId, EOA);
  const walletClient = createWalletClient({ account, chain, transport: http(process.env.RPC_URL!, { timeout: 30_000 }) });

  const msgRes = await fetch(predictBase + "/v1/auth/message", { headers: { "x-api-key": predictKey } });
  const msgData = await msgRes.json() as any;
  const authSig = await walletClient.signMessage({ account, message: msgData.data.message });
  const loginRes = await fetch(predictBase + "/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": predictKey },
    body: JSON.stringify({ signer: getAddress(EOA), message: msgData.data.message, signature: authSig }),
  });
  const loginData = await loginRes.json() as any;
  const jwt = loginData.data?.token || loginData.token;

  const posRes = await fetch(predictBase + "/v1/positions?signer=" + getAddress(EOA), {
    headers: { "x-api-key": predictKey, Authorization: "Bearer " + jwt },
  });
  const posBody = await posRes.json() as any;
  console.log(JSON.stringify(posBody, null, 2));
  process.exit(0);
}
main();
