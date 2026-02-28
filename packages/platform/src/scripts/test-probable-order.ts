/**
 * Test Probable order placement against a LIQUID market.
 *
 * Previous test proved signatureType=2 gets orders accepted, but the market had
 * zero liquidity. This script targets the most liquid Probable market to verify
 * that IOC orders actually FILL when there's a counterparty.
 *
 * Target: "Will Satoshi Move any Bitcoin in 2026?" — 5.97M depth, 0.1% spread
 *
 * Usage: npx tsx packages/platform/src/scripts/test-probable-order.ts
 */
import "dotenv/config";
import { createWalletClient, createPublicClient, http, defineChain, encodeFunctionData, formatUnits } from "viem";
import { createPrivyAccount } from "../wallets/privy-account.js";
import { getOrCreateWallet } from "../wallets/privy-wallet.js";
import {
  buildOrder,
  signOrder,
  serializeOrder,
  buildHmacSignature,
  signClobAuth,
} from "@prophet/agent/src/clob/signing.js";

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;
const ERC20_ABI = [
  { name: "balanceOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "account", type: "address" as const }], outputs: [{ name: "", type: "uint256" as const }] },
  { name: "transfer", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "to", type: "address" as const }, { name: "amount", type: "uint256" as const }], outputs: [{ name: "", type: "bool" as const }] },
] as const;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const rpcUrl = process.env.RPC_URL!;
const chainId = 56;
const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";
const safeAddress = "0xD2d193AbB6Ca9365C4D32E52e26a7264F30FfCF9" as `0x${string}`;
const eoaAddress = "0xdAD013D95aCB067B2431fde18cbAc2BC92EF6B6C" as `0x${string}`;

const PROBABLE_API_BASE = (process.env.PROBABLE_API_BASE ?? "https://api.probable.markets").replace(/\/$/, "");
const PROBABLE_EXCHANGE = "0xF99F5367ce708c66F0860B77B4331301A5597c86" as `0x${string}`;
const PROBABLE_DOMAIN_NAME = "Probable CTF Exchange";
const PROBABLE_SCALE = 1_000_000_000_000_000_000; // 1e18
const FEE_RATE_BPS = 175; // Probable minimum 1.75%

// "Will TSM stock price hit $400 USD before March 7, 2026?" — near 50/50 market, good spread
const YES_TOKEN_ID = "85816119138488806917890372677499645276395745411408451919990609806197341268054";
const NO_TOKEN_ID = "92185183208247978000468392592089791661199805793991565998393935605778429918529";
const TOKEN_ID = YES_TOKEN_ID;
const SIDE = "BUY" as const;
const ORDER_SIZE = 1; // $1 — small to minimize cost

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function divider() { return "=".repeat(80); }
function subDivider() { return "-".repeat(80); }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface L2Creds {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

function getL2AuthHeaders(
  creds: L2Creds,
  signerAddress: string,
  method: string,
  requestPath: string,
  body?: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = buildHmacSignature(creds.apiSecret, timestamp, method, requestPath, body);
  return {
    Prob_address: signerAddress,
    Prob_signature: sig,
    Prob_timestamp: String(timestamp),
    Prob_api_key: creds.apiKey,
    Prob_passphrase: creds.apiPassphrase,
  };
}

// ---------------------------------------------------------------------------
// Orderbook fetch
// ---------------------------------------------------------------------------

async function fetchOrderbook(tokenId: string): Promise<{ bestBid: number | null; bestAsk: number | null; bids: unknown[]; asks: unknown[] }> {
  const url = `${PROBABLE_API_BASE}/public/api/v1/book?token_id=${tokenId}`;
  console.log(`  GET ${url}`);

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    console.log(`  Orderbook fetch failed: ${res.status} ${await res.text()}`);
    return { bestBid: null, bestAsk: null, bids: [], asks: [] };
  }

  const data = await res.json() as Record<string, unknown>;
  const bids = (data.bids ?? []) as Array<Record<string, unknown>>;
  const asks = (data.asks ?? []) as Array<Record<string, unknown>>;

  const bestBid = bids.length > 0 ? Number(bids[0].price ?? 0) : null;
  const bestAsk = asks.length > 0 ? Number(asks[0].price ?? 0) : null;

  return { bestBid, bestAsk, bids, asks };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(divider());
  console.log("TEST: Probable order placement — parameter sweep");
  console.log(divider());
  console.log();

  // -------------------------------------------------------------------------
  // 1. Set up wallet via Privy
  // -------------------------------------------------------------------------
  console.log("[1] Setting up Privy wallet...");
  const { walletId } = await getOrCreateWallet(userId);
  console.log(`  Privy walletId: ${walletId}`);
  console.log(`  EOA (signer):   ${eoaAddress}`);
  console.log(`  Safe (maker):   ${safeAddress}`);

  const chain = defineChain({
    id: chainId,
    name: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const account = createPrivyAccount(walletId, eoaAddress);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });

  // -------------------------------------------------------------------------
  // 1b. Check & fund Safe if needed
  // -------------------------------------------------------------------------
  const MIN_SAFE_BALANCE = 3_000_000_000_000_000_000n; // 3 USDT (enough for test orders)
  const FUND_AMOUNT = 5_000_000_000_000_000_000n; // 5 USDT

  const safeBal = await publicClient.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: "balanceOf", args: [safeAddress] });
  console.log(`  Safe USDT balance: ${formatUnits(safeBal, 18)}`);

  if (safeBal < MIN_SAFE_BALANCE) {
    console.log(`  Safe below ${formatUnits(MIN_SAFE_BALANCE, 18)} USDT — funding with ${formatUnits(FUND_AMOUNT, 18)} USDT from EOA...`);
    const eoaBal = await publicClient.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: "balanceOf", args: [eoaAddress] });
    if (eoaBal < FUND_AMOUNT) {
      console.error(`  FATAL: EOA only has ${formatUnits(eoaBal, 18)} USDT, need ${formatUnits(FUND_AMOUNT, 18)}`);
      process.exit(1);
    }
    const txHash = await walletClient.sendTransaction({
      to: BSC_USDT,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [safeAddress, FUND_AMOUNT] }),
    });
    console.log(`  Funding tx: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    console.log(`  Funded! Block: ${receipt.blockNumber}, Status: ${receipt.status}`);
    const newBal = await publicClient.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: "balanceOf", args: [safeAddress] });
    console.log(`  Safe USDT balance now: ${formatUnits(newBal, 18)}`);
  }

  // -------------------------------------------------------------------------
  // 2. Fetch orderbook
  // -------------------------------------------------------------------------
  console.log();
  console.log("[2] Fetching orderbooks (YES + NO)...");
  const yesOb = await fetchOrderbook(YES_TOKEN_ID);
  const noOb = await fetchOrderbook(NO_TOKEN_ID);
  console.log(`  YES — Best bid: ${yesOb.bestBid}, Best ask: ${yesOb.bestAsk}`);
  console.log(`  YES — Bids (top 5): ${JSON.stringify(yesOb.bids.slice(0, 5), null, 2)}`);
  console.log(`  YES — Asks (top 5): ${JSON.stringify(yesOb.asks.slice(0, 5), null, 2)}`);
  console.log(`  NO  — Best bid: ${noOb.bestBid}, Best ask: ${noOb.bestAsk}`);
  console.log(`  NO  — Asks (top 3): ${JSON.stringify(noOb.asks.slice(0, 3), null, 2)}`);

  if (yesOb.asks.length === 0) {
    console.error("  FATAL: YES token has no asks — cannot test BUY fills. Pick a different market.");
    process.exit(1);
  }

  const ob = yesOb; // alias for rest of script (testing YES token)

  // For GTC BUY: place BELOW best ask so it sits on the book
  // For IOC BUY: place AT best ask so it fills immediately
  const gtcPrice = ob.bestBid != null ? ob.bestBid : 0.05;
  const iocPrice = ob.bestAsk!;
  console.log(`  GTC BUY price (at best bid): ${gtcPrice}`);
  console.log(`  IOC BUY price (at best ask): ${iocPrice}`);

  // -------------------------------------------------------------------------
  // 3. Authenticate (L1 -> L2 API key)
  // -------------------------------------------------------------------------
  console.log();
  console.log("[3] Authenticating with Probable (L1 -> API key)...");

  const auth = await signClobAuth(walletClient, chainId);
  const l1Headers: Record<string, string> = {
    Prob_address: auth.address,
    Prob_signature: auth.signature,
    Prob_timestamp: auth.timestamp,
    Prob_nonce: "0",
  };

  let creds: L2Creds;

  const createRes = await fetch(`${PROBABLE_API_BASE}/public/api/v1/auth/api-key/${chainId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...l1Headers },
    signal: AbortSignal.timeout(10_000),
  });

  if (createRes.ok) {
    const keyData = await createRes.json() as Record<string, unknown>;
    creds = {
      apiKey: keyData.apiKey as string,
      apiSecret: keyData.secret as string,
      apiPassphrase: keyData.passphrase as string,
    };
  } else {
    console.log(`  createApiKey returned ${createRes.status}, trying deriveApiKey...`);
    const deriveAuth = await signClobAuth(walletClient, chainId);
    const deriveHeaders: Record<string, string> = {
      Prob_address: deriveAuth.address,
      Prob_signature: deriveAuth.signature,
      Prob_timestamp: deriveAuth.timestamp,
      Prob_nonce: "0",
    };
    const deriveRes = await fetch(`${PROBABLE_API_BASE}/public/api/v1/auth/derive-api-key/${chainId}`, {
      method: "GET",
      headers: deriveHeaders,
      signal: AbortSignal.timeout(10_000),
    });
    if (!deriveRes.ok) {
      console.error(`  deriveApiKey failed: ${deriveRes.status} ${await deriveRes.text()}`);
      process.exit(1);
    }
    const keyData = await deriveRes.json() as Record<string, unknown>;
    creds = {
      apiKey: keyData.apiKey as string,
      apiSecret: keyData.secret as string,
      apiPassphrase: keyData.passphrase as string,
    };
  }
  console.log(`  API key: ${creds.apiKey.slice(0, 8)}...`);

  // -------------------------------------------------------------------------
  // 4. Define parameter combinations
  // -------------------------------------------------------------------------

  interface Combo {
    label: string;
    signatureType: number;
    orderType: "GTC" | "IOC";
    deferExec: boolean;
    expirationSec: number; // 0 = far-future, >0 = relative seconds
    maker: `0x${string}`;
    price: number;
  }

  // Only test signatureType=2 (proven working) — focus is on FILL verification
  const combos: Combo[] = [
    // IOC BUY at best ask — should fill immediately against asks
    { label: "IOC BUY at bestAsk, deferExec=true",   signatureType: 2, orderType: "IOC", deferExec: true,  expirationSec: 300, maker: safeAddress, price: iocPrice },
    // IOC BUY slightly above best ask — more aggressive, but cap at 0.99 to avoid "max price" error
    { label: "IOC BUY at bestAsk+0.01, deferExec=true", signatureType: 2, orderType: "IOC", deferExec: true,  expirationSec: 300, maker: safeAddress, price: Math.min(iocPrice + 0.01, 0.99) },
    // GTC BUY at best bid — should sit on book (verify it appears)
    { label: "GTC BUY at bestBid, deferExec=true",   signatureType: 2, orderType: "GTC", deferExec: true,  expirationSec: 300, maker: safeAddress, price: gtcPrice },
    // IOC BUY with deferExec=false — test if deferred exec matters for fills
    { label: "IOC BUY at bestAsk, deferExec=false",  signatureType: 2, orderType: "IOC", deferExec: false, expirationSec: 300, maker: safeAddress, price: iocPrice },
  ];

  // -------------------------------------------------------------------------
  // 5. Iterate over combinations
  // -------------------------------------------------------------------------

  console.log();
  console.log("[4] Testing parameter combinations...");
  console.log(`  Total combinations: ${combos.length}`);
  console.log();

  const results: Array<{ label: string; status: number; response: string; orderId?: string }> = [];
  let foundFill = false;

  for (let i = 0; i < combos.length; i++) {
    const combo = combos[i];
    console.log(subDivider());
    console.log(`[${i + 1}/${combos.length}] ${combo.label}`);
    console.log(subDivider());

    try {
      // Build order
      const order = buildOrder({
        maker: combo.maker,
        signer: eoaAddress,
        tokenId: TOKEN_ID,
        side: SIDE,
        price: combo.price,
        size: ORDER_SIZE,
        feeRateBps: FEE_RATE_BPS,
        expirationSec: combo.expirationSec,
        nonce: 0n,
        scale: PROBABLE_SCALE,
        signatureType: combo.signatureType,
        quantize: true,
        slippageBps: 0, // No slippage — we set the price explicitly to best ask/bid
      });

      console.log("  Order details:");
      console.log(`    maker:         ${order.maker}`);
      console.log(`    signer:        ${order.signer}`);
      console.log(`    makerAmount:   ${order.makerAmount} (USDT wei)`);
      console.log(`    takerAmount:   ${order.takerAmount} (shares wei)`);
      console.log(`    expiration:    ${order.expiration}`);
      console.log(`    signatureType: ${order.signatureType}`);
      console.log(`    side:          ${order.side} (0=BUY)`);
      console.log(`    implied price: ${Number(order.makerAmount) / Number(order.takerAmount)}`);

      // Sign
      const signed = await signOrder(
        walletClient,
        order,
        chainId,
        PROBABLE_EXCHANGE,
        PROBABLE_DOMAIN_NAME,
      );
      console.log(`  Signature: ${signed.signature.slice(0, 20)}...`);

      // Build payload (exact key order matching ProbableClobClient)
      const serialized = serializeOrder(signed.order);
      const body = {
        deferExec: combo.deferExec,
        order: {
          salt: serialized.salt,
          maker: serialized.maker,
          signer: serialized.signer,
          taker: serialized.taker,
          tokenId: serialized.tokenId,
          makerAmount: serialized.makerAmount,
          takerAmount: serialized.takerAmount,
          side: serialized.side,
          expiration: serialized.expiration,
          nonce: serialized.nonce,
          feeRateBps: serialized.feeRateBps,
          signatureType: serialized.signatureType,
          signature: signed.signature,
        },
        owner: combo.maker,
        orderType: combo.orderType,
      };

      const requestPath = `/public/api/v1/order/${chainId}`;
      const bodyStr = JSON.stringify(body);

      console.log();
      console.log("  Request body:");
      console.log(JSON.stringify(body, null, 2));

      // L2 headers
      const headers = getL2AuthHeaders(creds, eoaAddress, "POST", requestPath, bodyStr);

      // POST
      const orderRes = await fetch(`${PROBABLE_API_BASE}${requestPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(15_000),
      });

      const orderResBody = await orderRes.text();
      console.log();
      console.log(`  Response: ${orderRes.status} ${orderRes.statusText}`);
      console.log(`  Body: ${orderResBody}`);

      let orderId: string | undefined;
      let filledQty: number | undefined;
      let orderStatus: string | undefined;

      if (orderRes.ok) {
        try {
          const resJson = JSON.parse(orderResBody);
          orderId = resJson.orderId ?? resJson.orderID ?? resJson.id;
          filledQty = resJson.executedQty ?? resJson.filledQty ?? resJson.cumQty;
          orderStatus = resJson.status;
          console.log(`  orderId:   ${orderId}`);
          console.log(`  status:    ${orderStatus}`);
          console.log(`  filledQty: ${filledQty}`);
        } catch { /* non-JSON response */ }
      }

      results.push({ label: combo.label, status: orderRes.status, response: orderResBody, orderId });

      // If order was accepted, poll for fill status
      if (orderRes.ok && orderId) {
        console.log();
        console.log("  Polling order status (3 attempts, 2s apart)...");
        for (let poll = 0; poll < 3; poll++) {
          await sleep(2000);
          const statusPath = `/public/api/v1/order/${chainId}/${orderId}`;
          const statusHeaders = getL2AuthHeaders(creds, eoaAddress, "GET", statusPath);
          const statusRes = await fetch(`${PROBABLE_API_BASE}${statusPath}`, {
            method: "GET",
            headers: statusHeaders,
            signal: AbortSignal.timeout(10_000),
          });

          if (statusRes.ok) {
            const statusData = await statusRes.json() as Record<string, unknown>;
            console.log(`  Poll ${poll + 1}: ${JSON.stringify(statusData)}`);
            const st = String(statusData.status ?? "").toUpperCase();
            const filled = Number(statusData.filled_size ?? statusData.filledSize ?? statusData.size_matched ?? 0);
            if (st === "MATCHED" || st === "FILLED" || filled > 0) {
              console.log(`  >>> FILLED! status=${st} filled=${filled}`);
              foundFill = true;
              break;
            }
          } else if (statusRes.status === 404) {
            // IOC orders vanish after processing — 404 means it was processed
            console.log(`  Poll ${poll + 1}: 404 (order processed/gone — IOC likely expired or filled)`);
          } else {
            console.log(`  Poll ${poll + 1}: ${statusRes.status} ${await statusRes.text()}`);
          }
        }

        // Cancel GTC orders so we don't leave them on the book
        if (combo.orderType === "GTC") {
          console.log(`  Cancelling GTC order ${orderId}...`);
          const cancelPath = `/public/api/v1/order/${chainId}/${orderId}?tokenId=${TOKEN_ID}`;
          const cancelHeaders = getL2AuthHeaders(creds, eoaAddress, "DELETE", cancelPath);
          const cancelRes = await fetch(`${PROBABLE_API_BASE}${cancelPath}`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...cancelHeaders,
            },
            signal: AbortSignal.timeout(10_000),
          });
          console.log(`  Cancel: ${cancelRes.status}`);
        }
      }

      if (foundFill) {
        console.log();
        console.log(">>> FOUND A FILLING COMBINATION! Stopping early.");
        break;
      }

    } catch (err) {
      console.error(`  ERROR: ${err}`);
      results.push({ label: combo.label, status: -1, response: String(err) });
    }

    // Wait between attempts
    if (i < combos.length - 1 && !foundFill) {
      console.log();
      console.log("  Waiting 5s before next attempt...");
      await sleep(5000);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Summary
  // -------------------------------------------------------------------------

  console.log();
  console.log(divider());
  console.log("SUMMARY");
  console.log(divider());
  console.log();

  for (const r of results) {
    const statusEmoji = r.status === 200 ? "OK " : r.status === -1 ? "ERR" : `${r.status}`;
    let brief = r.response;
    try {
      const parsed = JSON.parse(r.response);
      brief = `status=${parsed.status ?? "?"} orderId=${parsed.orderId ?? parsed.orderID ?? "?"} filled=${parsed.executedQty ?? parsed.filledQty ?? "?"}`;
    } catch { /* keep raw */ }
    if (brief.length > 120) brief = brief.slice(0, 120) + "...";
    console.log(`  [${statusEmoji}] ${r.label}`);
    console.log(`        ${brief}`);
  }

  // Re-fetch orderbook at end to see if anything changed
  console.log();
  console.log("Final orderbook state:");
  const finalOb = await fetchOrderbook(YES_TOKEN_ID);
  console.log(`  Best bid: ${finalOb.bestBid}`);
  console.log(`  Best ask: ${finalOb.bestAsk}`);
  console.log(`  Bids (top 3): ${JSON.stringify(finalOb.bids.slice(0, 3))}`);
  console.log(`  Asks (top 3): ${JSON.stringify(finalOb.asks.slice(0, 3))}`);

  // Check final Safe balance
  const finalSafeBal = await publicClient.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: "balanceOf", args: [safeAddress] });
  console.log();
  console.log(`Final Safe USDT: ${formatUnits(finalSafeBal, 18)}`);

  console.log();
  console.log(divider());
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
