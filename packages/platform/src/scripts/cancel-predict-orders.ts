/**
 * Cancel all open Predict.fun orders to free up locked collateral.
 * Usage: pnpm --filter platform exec tsx src/scripts/cancel-predict-orders.ts
 */
import "dotenv/config";
import { createWalletClient, http, defineChain, getAddress } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { createDb } from "@prophet/shared/db";
import { tradingWallets } from "@prophet/shared/db";
import { eq } from "drizzle-orm";

const rpcUrl = process.env.RPC_URL!;
const chainId = 56;
const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";
const eoaAddress = "0xdad013d95acb067b2431fde18cbac2bc92ef6b6c" as `0x${string}`;

const PREDICT_API_BASE = (process.env.PREDICT_API_BASE ?? "").replace(/\/$/, "");
const PREDICT_API_KEY = process.env.PREDICT_API_KEY ?? "";

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
  if (!wallet) { console.error("No wallet found"); process.exit(1); }

  const chain = defineChain({
    id: chainId,
    name: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const account = createPrivyAccount(wallet.privyWalletId, eoaAddress);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  // Authenticate
  console.log("Authenticating...");
  const msgRes = await fetch(`${PREDICT_API_BASE}/v1/auth/message`, {
    headers: { "x-api-key": PREDICT_API_KEY },
    signal: AbortSignal.timeout(10_000),
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
  console.log(`  JWT acquired`);

  // Fetch open orders
  console.log("\nFetching open orders...");
  const ordersRes = await fetch(
    `${PREDICT_API_BASE}/v1/orders?address=${getAddress(eoaAddress)}&status=OPEN`,
    {
      headers: { Authorization: `Bearer ${jwt}`, "x-api-key": PREDICT_API_KEY },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const ordersBody = await ordersRes.text();
  console.log(`  GET /v1/orders?status=OPEN => ${ordersRes.status}`);

  let orders: any[] = [];
  try {
    const parsed = JSON.parse(ordersBody);
    orders = parsed.data ?? parsed ?? [];
    if (!Array.isArray(orders)) orders = [orders];
  } catch {
    console.log(`  Raw response: ${ordersBody.slice(0, 500)}`);
  }

  console.log(`  Found ${orders.length} open orders`);

  if (orders.length === 0) {
    console.log("No open orders to cancel.");
    process.exit(0);
  }

  for (const order of orders) {
    const id = order.orderId ?? order.id ?? order.order_id;
    const price = order.price ?? order.pricePerShare;
    const tokenId = order.tokenId;
    console.log(`  Order ${id}: price=${price}, token=${String(tokenId).slice(0, 20)}...`);
  }

  // Cancel all
  const ids = orders.map((o: any) => String(o.orderId ?? o.id ?? o.order_id));
  console.log(`\nCancelling ${ids.length} orders: ${ids.join(", ")}`);

  const cancelRes = await fetch(`${PREDICT_API_BASE}/v1/orders/remove`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "x-api-key": PREDICT_API_KEY,
    },
    body: JSON.stringify({ data: { ids } }),
    signal: AbortSignal.timeout(15_000),
  });
  const cancelBody = await cancelRes.text();
  console.log(`  POST /v1/orders/remove => ${cancelRes.status}`);
  console.log(`  Response: ${cancelBody}`);

  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
