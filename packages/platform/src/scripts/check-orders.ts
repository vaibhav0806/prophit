/**
 * Check status of Predict orders by ID.
 * Usage: pnpm --filter platform exec tsx src/scripts/check-orders.ts [orderId1] [orderId2] ...
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

  // Auth
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

  // Check orders from CLI args or default list
  const orderIds = process.argv.slice(2);
  if (orderIds.length > 0) {
    for (const id of orderIds) {
      const res = await fetch(predictBase + "/v1/orders/" + id, {
        headers: { "x-api-key": predictKey, Authorization: "Bearer " + jwt },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json() as any;
      const order = body.data || body;
      console.log(`Order ${id}: status=${order.status || order.state} filled=${order.filledAmount || order.sizeFilled || "?"} total=${order.originalAmount || order.size || "?"}`);
      if (res.status !== 200) console.log("  raw:", JSON.stringify(body).slice(0, 300));
    }
  }

  // Always check remaining positions
  console.log("\nRemaining positions:");
  const posRes = await fetch(predictBase + "/v1/positions?signer=" + getAddress(EOA), {
    headers: { "x-api-key": predictKey, Authorization: "Bearer " + jwt },
  });
  const posBody = await posRes.json() as any;
  const positions = posBody.data || [];
  if (positions.length === 0) {
    console.log("  None — all sold!");
  } else {
    for (const p of positions) {
      console.log(`  Market ${p.market.id}: ${p.market.title} | $${p.valueUsd}`);
    }
  }

  process.exit(0);
}
main();
