/**
 * Check all positions and recent order history on Predict.fun
 * Usage: pnpm --filter platform exec tsx src/scripts/check-predict-positions.ts
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

  const chain = defineChain({
    id: 56, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const account = createPrivyAccount(wallet.privyWalletId, eoaAddress);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  // Authenticate
  const msgRes = await fetch(`${PREDICT_API_BASE}/v1/auth/message`, {
    headers: { "x-api-key": PREDICT_API_KEY }, signal: AbortSignal.timeout(10_000),
  });
  const { data: { message } } = await msgRes.json() as any;
  const signature = await walletClient.signMessage({ account, message });
  const loginRes = await fetch(`${PREDICT_API_BASE}/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": PREDICT_API_KEY },
    body: JSON.stringify({ signer: getAddress(eoaAddress), message, signature }),
    signal: AbortSignal.timeout(10_000),
  });
  const loginData = await loginRes.json() as any;
  const jwt = loginData.data?.token ?? loginData.token;

  // Check positions
  console.log("=== POSITIONS ===");
  const posRes = await fetch(`${PREDICT_API_BASE}/v1/positions`, {
    headers: { Authorization: `Bearer ${jwt}`, "x-api-key": PREDICT_API_KEY },
    signal: AbortSignal.timeout(10_000),
  });
  const posBody = await posRes.text();
  console.log(`GET /v1/positions => ${posRes.status}`);
  try {
    const parsed = JSON.parse(posBody);
    const positions = parsed.data ?? [];
    console.log(`Found ${positions.length} positions:`);
    for (const p of positions) {
      console.log(`  ID: ${p.id}`);
      console.log(`  Market: ${p.market?.title ?? p.market?.question ?? "unknown"}`);
      console.log(`  Outcome: ${p.outcome?.name ?? "unknown"}`);
      console.log(`  Amount: ${p.amount} (${p.valueUsd ?? "?"} USD)`);
      console.log();
    }
  } catch {
    console.log(posBody.slice(0, 1000));
  }

  // Check recent orders (all statuses)
  console.log("=== RECENT ORDERS ===");
  for (const status of ["OPEN", "FILLED", "CANCELLED"]) {
    const ordersRes = await fetch(
      `${PREDICT_API_BASE}/v1/orders?address=${getAddress(eoaAddress)}&status=${status}`,
      {
        headers: { Authorization: `Bearer ${jwt}`, "x-api-key": PREDICT_API_KEY },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const ordersBody = await ordersRes.text();
    try {
      const parsed = JSON.parse(ordersBody);
      const orders = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
      console.log(`\n${status}: ${orders.length} orders`);
      for (const o of orders.slice(0, 5)) {
        console.log(`  ID: ${o.orderId ?? o.id}, price: ${o.price ?? o.pricePerShare}, side: ${o.side}, status: ${o.status}`);
      }
    } catch {
      console.log(`${status}: ${ordersRes.status} — ${ordersBody.slice(0, 200)}`);
    }
  }

  // Check account activity
  console.log("\n=== ACCOUNT ACTIVITY ===");
  const actRes = await fetch(`${PREDICT_API_BASE}/v1/account/activity`, {
    headers: { Authorization: `Bearer ${jwt}`, "x-api-key": PREDICT_API_KEY },
    signal: AbortSignal.timeout(10_000),
  });
  console.log(`GET /v1/account/activity => ${actRes.status}`);
  const actBody = await actRes.text();
  try {
    const parsed = JSON.parse(actBody);
    const activities = parsed.data ?? [];
    console.log(`Found ${activities.length} activities (showing last 10):`);
    for (const a of activities.slice(0, 10)) {
      console.log(`  ${JSON.stringify(a).slice(0, 200)}`);
    }
  } catch {
    console.log(actBody.slice(0, 500));
  }

  process.exit(0);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
