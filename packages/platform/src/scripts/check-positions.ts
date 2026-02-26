/**
 * Check open positions on Predict and Probable.
 * Usage: pnpm --filter platform exec tsx src/scripts/check-positions.ts
 */
import "dotenv/config";
import { createWalletClient, http, defineChain, getAddress } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { createDb } from "@prophit/shared/db";
import { tradingWallets } from "@prophit/shared/db";
import { eq } from "drizzle-orm";
import { buildHmacSignature, signClobAuth } from "@prophit/agent/src/clob/signing.js";

const EOA = "0xdad013d95acb067b2431fde18cbac2bc92ef6b6c" as `0x${string}`;
const SAFE = "0xD2d193AbB6Ca9365C4D32E52e26a7264F30FfCF9";
const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";
const chainId = 56;

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
  if (!wallet) { console.log("No wallet"); process.exit(1); }

  const rpcUrl = process.env.RPC_URL!;
  const chain = defineChain({ id: chainId, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const account = createPrivyAccount(wallet.privyWalletId, EOA);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });

  // --- Predict ---
  const predictBase = (process.env.PREDICT_API_BASE || "").replace(/\/$/, "");
  const predictKey = process.env.PREDICT_API_KEY || "";

  if (predictBase && predictKey) {
    console.log("=== PREDICT POSITIONS (EOA) ===");
    try {
      const msgRes = await fetch(predictBase + "/v1/auth/message", { headers: { "x-api-key": predictKey }, signal: AbortSignal.timeout(10_000) });
      const msgData = await msgRes.json() as any;
      const authMessage = msgData.data.message;
      const authSig = await walletClient.signMessage({ account, message: authMessage });
      const loginRes = await fetch(predictBase + "/v1/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": predictKey },
        body: JSON.stringify({ signer: getAddress(EOA), message: authMessage, signature: authSig }),
        signal: AbortSignal.timeout(10_000),
      });
      const loginData = await loginRes.json() as any;
      const jwt = loginData.data?.token || loginData.token;

      const posRes = await fetch(predictBase + "/v1/positions?signer=" + getAddress(EOA), {
        headers: { "x-api-key": predictKey, Authorization: "Bearer " + jwt },
        signal: AbortSignal.timeout(10_000),
      });
      console.log("HTTP:", posRes.status);
      const posBody = await posRes.json() as any;
      const positions = posBody.data || posBody;
      if (Array.isArray(positions) && positions.length > 0) {
        console.log("Found", positions.length, "position(s):");
        for (const p of positions) {
          console.log(" ", JSON.stringify(p).slice(0, 400));
        }
      } else {
        console.log("No open positions");
        console.log("Raw:", JSON.stringify(posBody).slice(0, 500));
      }
    } catch (e: any) { console.log("Predict error:", e.message); }
  }

  // --- Probable ---
  const probBase = (process.env.PROBABLE_API_BASE || "https://api.probable.markets").replace(/\/$/, "");
  console.log("\n=== PROBABLE OPEN ORDERS (Safe) ===");
  try {
    const auth = await signClobAuth(walletClient, chainId);
    const l1Headers: Record<string, string> = {
      Prob_address: auth.address,
      Prob_signature: auth.signature,
      Prob_timestamp: auth.timestamp,
      Prob_nonce: "0",
    };
    const deriveRes = await fetch(probBase + "/public/api/v1/auth/derive-api-key/" + chainId, {
      method: "GET",
      headers: l1Headers,
      signal: AbortSignal.timeout(10_000),
    });
    const keyData = await deriveRes.json() as any;
    const apiKey = keyData.apiKey;
    const apiSecret = keyData.secret;
    const apiPassphrase = keyData.passphrase;

    const requestPath = "/public/api/v1/orders/" + chainId + "?owner=" + SAFE;
    const timestamp = Math.floor(Date.now() / 1000);
    const hmacSig = buildHmacSignature(apiSecret, timestamp, "GET", requestPath);
    const ordersRes = await fetch(probBase + requestPath, {
      headers: {
        Prob_address: account.address,
        Prob_signature: hmacSig,
        Prob_timestamp: String(timestamp),
        Prob_api_key: apiKey,
        Prob_passphrase: apiPassphrase,
      },
      signal: AbortSignal.timeout(10_000),
    });
    console.log("HTTP:", ordersRes.status);
    const ordersBody = await ordersRes.text();
    try {
      const parsed = JSON.parse(ordersBody);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log("Found", parsed.length, "open order(s):");
        for (const o of parsed) { console.log(" ", JSON.stringify(o).slice(0, 300)); }
      } else {
        console.log("No open orders");
        console.log("Raw:", ordersBody.slice(0, 500));
      }
    } catch { console.log("Raw:", ordersBody.slice(0, 500)); }
  } catch (e: any) { console.log("Probable error:", e.message); }

  process.exit(0);
}
main();
