import type { PublicClient, WalletClient } from "viem";
import { getAddress, hashTypedData } from "viem";
import type {
  ClobClient,
  PlaceOrderParams,
  OrderResult,
  OrderSide,
  OrderStatusResult,
  OrderStatus,
} from "./types.js";
import { ORDER_EIP712_TYPES } from "./types.js";
import { buildOrder, signOrder } from "./signing.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";

const ERC1155_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const ERC1155_SET_APPROVAL_ABI = [
  {
    type: "function",
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// Well-known BSC addresses for Predict.fun
const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

// Predict.fun EIP-712 domain name (different from Polymarket/Probable "ClobExchange")
const PREDICT_DOMAIN_NAME = "predict.fun CTF Exchange";

// Predict.fun uses 18-decimal scaling (not 6-decimal like Polymarket/Probable)
const PREDICT_SCALE = 1_000_000_000_000_000_000; // 1e18

// Predict.fun exchange contracts by market type (isNegRisk, isYieldBearing):
const PREDICT_EXCHANGE_STANDARD = "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689" as `0x${string}`;
const PREDICT_EXCHANGE_NEGRISK = "0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A" as `0x${string}`;
const PREDICT_EXCHANGE_YIELD = "0x6bEb5a40C032AFc305961162d8204CDA16DECFa5" as `0x${string}`;
const PREDICT_EXCHANGE_YIELD_NEGRISK = "0x8A289d458f5a134bA40015085A8F50Ffb681B41d" as `0x${string}`;

const ALL_PREDICT_EXCHANGES = [
  PREDICT_EXCHANGE_STANDARD,
  PREDICT_EXCHANGE_NEGRISK,
  PREDICT_EXCHANGE_YIELD,
  PREDICT_EXCHANGE_YIELD_NEGRISK,
] as const;

// CTF (conditional token) contracts — standard and yield-bearing variants
const PREDICT_CTF_STANDARD = "0x22DA1810B194ca018378464a58f6Ac2B10C9d244" as `0x${string}`;
const PREDICT_CTF_YIELD = "0x9400F8Ad57e9e0F352345935d6D3175975eb1d9F" as `0x${string}`;
const PREDICT_CTF_NEGRISK = "0x22DA1810B194ca018378464a58f6Ac2B10C9d244" as `0x${string}`; // same as standard
const PREDICT_CTF_YIELD_NEGRISK = "0xF64b0b318AAf83BD9071110af24D24445719A07F" as `0x${string}`;

// NegRisk adapter contracts — need ERC-1155 approval on CTF for SELL orders on negRisk markets
const PREDICT_NEGRISK_ADAPTER = "0xc3Cf7c252f65E0d8D88537dF96569AE94a7F1A6E" as `0x${string}`;
const PREDICT_YIELD_NEGRISK_ADAPTER = "0x41dCe1A4B8FB5e6327701750aF6231B7CD0B2A40" as `0x${string}`;

// Each CTF contract needs approval for its corresponding exchange(s) and adapters
const CTF_EXCHANGE_PAIRS: Array<{ ctf: `0x${string}`; exchanges: `0x${string}`[] }> = [
  { ctf: PREDICT_CTF_STANDARD, exchanges: [PREDICT_EXCHANGE_STANDARD, PREDICT_EXCHANGE_NEGRISK, PREDICT_NEGRISK_ADAPTER] },
  { ctf: PREDICT_CTF_YIELD, exchanges: [PREDICT_EXCHANGE_YIELD] },
  { ctf: PREDICT_CTF_YIELD_NEGRISK, exchanges: [PREDICT_EXCHANGE_YIELD_NEGRISK, PREDICT_YIELD_NEGRISK_ADAPTER] },
];

const MIN_FEE_RATE_BPS = 200;

export class PredictClobClient implements ClobClient {
  readonly name = "Predict";
  readonly exchangeAddress: `0x${string}`;

  private walletClient: WalletClient;
  private apiBase: string;
  private apiKey: string;
  private chainId: number;
  private feeRateBps: number;
  private expirationSec: number;
  private dryRun: boolean;
  private nonce: bigint;
  private jwt: string | null;
  private jwtExpiresAt = 0; // epoch seconds
  private refreshPromise: Promise<string> | null = null;
  private exchangeCache: Map<string, `0x${string}`>;

  constructor(params: {
    walletClient: WalletClient;
    apiBase: string;
    apiKey: string;
    exchangeAddress: `0x${string}`;
    chainId: number;
    expirationSec?: number;
    dryRun?: boolean;
  }) {
    this.walletClient = params.walletClient;
    this.apiBase = params.apiBase.replace(/\/$/, "");
    this.apiKey = params.apiKey;
    this.exchangeAddress = params.exchangeAddress;
    this.chainId = params.chainId;
    this.feeRateBps = 200;
    this.expirationSec = params.expirationSec ?? 300;
    this.dryRun = params.dryRun ?? false;
    this.nonce = 0n;
    this.jwt = null;
    this.exchangeCache = new Map();
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async authenticate(): Promise<void> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account");

    // Step 1: GET auth message (nonce)
    const msgRes = await fetch(`${this.apiBase}/v1/auth/message`, {
      headers: { "x-api-key": this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!msgRes.ok) {
      const body = await msgRes.text();
      throw new Error(`Predict auth/message failed (${msgRes.status}): ${body}`);
    }
    const msgData = (await msgRes.json()) as { success: boolean; data: { message: string } };
    const message = msgData.data.message;

    // Step 2: Sign the message
    const signature = await this.walletClient.signMessage({
      account,
      message,
    });

    // Step 3: POST login — use checksummed address (Predict API is case-sensitive)
    const loginRes = await fetch(`${this.apiBase}/v1/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ signer: getAddress(account.address), message, signature }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!loginRes.ok) {
      const body = await loginRes.text();
      throw new Error(`Predict auth/login failed (${loginRes.status}): ${body}`);
    }
    const loginData = (await loginRes.json()) as { success?: boolean; data?: { token: string }; token?: string };
    this.jwt = loginData.data?.token ?? loginData.token ?? null;

    // Parse expiry from JWT payload
    if (this.jwt) {
      try {
        const payload = JSON.parse(Buffer.from(this.jwt.split(".")[1], "base64").toString());
        this.jwtExpiresAt = payload.exp ?? 0;
      } catch {
        this.jwtExpiresAt = 0;
      }
    }

    log.info("Predict JWT authenticated", { address: account.address });
  }

  private async ensureAuth(): Promise<string> {
    // Still valid with 30s buffer
    if (this.jwt && Date.now() / 1000 < this.jwtExpiresAt - 30) {
      return this.jwt;
    }

    // Another call is already refreshing — wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // We are the refresher — set the mutex promise
    this.refreshPromise = (async () => {
      try {
        await this.authenticate();
        if (!this.jwt) throw new Error("Predict authentication failed — no JWT");
        return this.jwt;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // ---------------------------------------------------------------------------
  // Per-market exchange address resolution
  // ---------------------------------------------------------------------------

  async getExchangeForMarket(marketId: string): Promise<`0x${string}`> {
    const cached = this.exchangeCache.get(marketId);
    if (cached) return cached;

    const jwt = await this.ensureAuth();
    const res = await fetch(`${this.apiBase}/v1/markets/${marketId}`, {
      headers: { Authorization: `Bearer ${jwt}`, "x-api-key": this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Predict GET /v1/markets/${marketId} failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as { data?: { isNegRisk?: boolean; isYieldBearing?: boolean }; isNegRisk?: boolean; isYieldBearing?: boolean };
    // API wraps response in { success, data: { ... } }
    const market = json.data ?? json;
    const isNegRisk = market.isNegRisk ?? false;
    const isYieldBearing = market.isYieldBearing ?? false;

    let exchange: `0x${string}`;
    if (isYieldBearing && isNegRisk) {
      exchange = PREDICT_EXCHANGE_YIELD_NEGRISK;
    } else if (isYieldBearing) {
      exchange = PREDICT_EXCHANGE_YIELD;
    } else if (isNegRisk) {
      exchange = PREDICT_EXCHANGE_NEGRISK;
    } else {
      exchange = PREDICT_EXCHANGE_STANDARD;
    }

    log.info("Predict resolved exchange for market", { marketId, isNegRisk, isYieldBearing, exchange });
    this.exchangeCache.set(marketId, exchange);
    return exchange;
  }

  // ---------------------------------------------------------------------------
  // Nonce management
  // ---------------------------------------------------------------------------

  async fetchNonce(): Promise<bigint> {
    log.info("Predict fetchNonce: using local nonce (no server endpoint)", { nonce: this.nonce });
    return this.nonce;
  }

  getNonce(): bigint {
    return this.nonce;
  }

  setNonce(n: bigint): void {
    this.nonce = n;
  }

  // ---------------------------------------------------------------------------
  // ClobClient interface
  // ---------------------------------------------------------------------------

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account");

    if (this.dryRun) {
      log.info("Predict placeOrder dry-run (early exit)", {
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
      });
      return { success: true, orderId: "dry-run", status: "dry-run" };
    }

    try {
      const jwt = await this.ensureAuth();

      // Resolve the correct exchange contract for this market's flags
      const exchange = params.marketId
        ? await this.getExchangeForMarket(params.marketId)
        : this.exchangeAddress;

      const feeRateBps = Math.max(this.feeRateBps, MIN_FEE_RATE_BPS);

      const order = buildOrder({
        maker: account.address,
        signer: account.address,
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        feeRateBps,
        expirationSec: this.expirationSec,
        nonce: this.nonce,
        scale: PREDICT_SCALE,
        slippageBps: params.strategy === "LIMIT" ? 0 : 200,
      });

      const { signature } = await signOrder(
        this.walletClient,
        order,
        this.chainId,
        exchange,
        PREDICT_DOMAIN_NAME,
      );

      // Compute the EIP-712 typed data hash (required by Predict.fun API)
      const orderMessage = {
        salt: order.salt,
        maker: order.maker,
        signer: order.signer,
        taker: order.taker,
        tokenId: order.tokenId,
        makerAmount: order.makerAmount,
        takerAmount: order.takerAmount,
        expiration: order.expiration,
        nonce: order.nonce,
        feeRateBps: order.feeRateBps,
        side: order.side,
        signatureType: order.signatureType,
      };

      const hash = hashTypedData({
        domain: {
          name: PREDICT_DOMAIN_NAME,
          version: "1",
          chainId: this.chainId,
          verifyingContract: exchange,
        },
        types: ORDER_EIP712_TYPES,
        primaryType: "Order",
        message: orderMessage,
      });

      // Predict.fun expects price as wei string (18 decimals)
      // e.g. price 0.50 → "500000000000000000"
      // Two-step multiply avoids IEEE 754 precision loss (e.g. 0.2195 * 1e18 drifts)
      const pricePerShare = (BigInt(Math.round(params.price * 1e8)) * 10_000_000_000n).toString();

      // Build the Predict.fun order payload:
      // - side is numeric (0 = BUY, 1 = SELL), not string
      // - signature and hash go inside the order object
      // - wrapped in { data: { order, pricePerShare, strategy } }
      // Checksum addresses — Predict API does case-sensitive comparison against JWT signer
      const payload = {
        data: {
          order: {
            salt: order.salt.toString(),
            maker: getAddress(order.maker),
            signer: getAddress(order.signer),
            taker: order.taker,
            tokenId: order.tokenId.toString(),
            makerAmount: order.makerAmount.toString(),
            takerAmount: order.takerAmount.toString(),
            expiration: order.expiration.toString(),
            nonce: order.nonce.toString(),
            feeRateBps: order.feeRateBps.toString(),
            side: order.side, // numeric: 0 (BUY) or 1 (SELL)
            signatureType: order.signatureType,
            signature,
            hash,
          },
          pricePerShare,
          strategy: params.strategy ?? "MARKET",
          isFillOrKill: params.isFillOrKill ?? (params.strategy === "LIMIT" ? false : true),
          ...(params.strategy === "LIMIT" ? {} : { slippageBps: "200" }),
        },
      };

      if (this.dryRun) {
        log.info("Predict placeOrder dry-run", {
          tokenId: params.tokenId,
          side: params.side,
          price: params.price,
          size: params.size,
          payload: payload as unknown as Record<string, unknown>,
        });
        return { success: true, orderId: "dry-run", status: "dry-run" };
      }

      const res = await withRetry(
        () => this.postOrder(jwt, payload),
        { retries: 2, label: "Predict placeOrder" },
      );

      if (!res.success) return res;

      log.info("Predict order placed", {
        orderId: res.orderId,
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
      });

      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Predict placeOrder failed", { error: msg });
      return { success: false, error: msg };
    }
  }

  private async postOrder(
    jwt: string,
    payload: Record<string, unknown>,
  ): Promise<OrderResult> {
    const bodyStr = JSON.stringify(payload);

    const res = await fetch(`${this.apiBase}/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        "x-api-key": this.apiKey,
      },
      body: bodyStr,
      signal: AbortSignal.timeout(10_000),
    });

    // Re-auth on 401 and retry
    if (res.status === 401) {
      this.jwt = null;
      const newJwt = await this.ensureAuth();
      const retry = await fetch(`${this.apiBase}/v1/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newJwt}`,
          "x-api-key": this.apiKey,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(10_000),
      });
      if (!retry.ok) {
        const body = await retry.text();
        throw new Error(`Predict POST /v1/orders failed after re-auth (${retry.status}): ${body}`);
      }
      const retryRaw = await retry.json();
      const retryData = (retryRaw?.data && typeof retryRaw.data === "object" ? retryRaw.data : retryRaw) as Record<string, unknown>;
      const retryOrderId = String(retryData.orderId ?? retryData.id ?? retryData.order_id ?? "");
      return { success: true, orderId: retryOrderId || undefined, status: typeof retryData.status === "string" ? retryData.status : undefined };
    }

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400 && body.includes("CollateralPerMarket")) {
        log.error("Predict: per-market collateral limit exceeded — not retrying", { body });
        return { success: false, error: "Per-market collateral limit exceeded. Reduce position size or wait for existing positions to close." };
      }
      throw new Error(`Predict POST /v1/orders failed (${res.status}): ${body}`);
    }

    const raw = await res.json();
    const data = (raw?.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
    const orderId = String(data.orderId ?? data.id ?? data.order_id ?? "");
    return { success: true, orderId: orderId || undefined, status: typeof data.status === "string" ? data.status : undefined };
  }

  async cancelOrder(orderId: string, _tokenId?: string): Promise<boolean> {
    try {
      const jwt = await this.ensureAuth();

      const body = JSON.stringify({ data: { ids: [orderId] } });

      const res = await fetch(`${this.apiBase}/v1/orders/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
          "x-api-key": this.apiKey,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 401) {
        this.jwt = null;
        const newJwt = await this.ensureAuth();
        const retry = await fetch(`${this.apiBase}/v1/orders/remove`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newJwt}`,
            "x-api-key": this.apiKey,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!retry.ok) {
          log.error("Predict cancelOrder failed after re-auth", { orderId, status: retry.status });
          return false;
        }
        return true;
      }

      if (!res.ok) {
        log.error("Predict cancelOrder failed", { orderId, status: res.status });
        return false;
      }

      log.info("Predict order cancelled", { orderId });
      return true;
    } catch (err) {
      log.error("Predict cancelOrder error", { orderId, error: String(err) });
      return false;
    }
  }

  async getOpenOrders(retried = false): Promise<
    Array<{ orderId: string; tokenId: string; side: OrderSide; price: number; size: number }>
  > {
    try {
      const jwt = await this.ensureAuth();
      const account = this.walletClient.account;
      if (!account) throw new Error("WalletClient has no account");

      const res = await fetch(
        `${this.apiBase}/v1/orders?address=${getAddress(account.address)}&status=OPEN`,
        {
          headers: {
            Authorization: `Bearer ${jwt}`,
            "x-api-key": this.apiKey,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (res.status === 401) {
        if (retried) {
          log.error("Predict getOpenOrders failed after re-auth retry", { status: res.status });
          return [];
        }
        this.jwt = null;
        await this.ensureAuth();
        return this.getOpenOrders(true);
      }

      if (!res.ok) {
        log.error("Predict getOpenOrders failed", { status: res.status });
        return [];
      }

      const json = await res.json();
      const data = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];

      return (data as Array<{
        orderId: string;
        tokenId: string;
        side: string;
        price: number | string;
        size: number | string;
      }>).map((o) => ({
        orderId: o.orderId,
        tokenId: o.tokenId,
        side: (o.side === "BUY" ? "BUY" : "SELL") as OrderSide,
        price: Number(o.price),
        size: Number(o.size),
      }));
    } catch (err) {
      log.error("Predict getOpenOrders error", { error: String(err) });
      return [];
    }
  }

  async getOrderStatus(orderId: string, retried = false): Promise<OrderStatusResult> {
    try {
      const jwt = await this.ensureAuth();

      const res = await fetch(`${this.apiBase}/v1/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          "x-api-key": this.apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 401) {
        if (retried) {
          log.warn("Predict getOrderStatus failed after re-auth retry", { orderId, status: res.status });
          return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 };
        }
        this.jwt = null;
        await this.ensureAuth();
        return this.getOrderStatus(orderId, true);
      }

      if (!res.ok) {
        // 404 means the order no longer exists. This can mean:
        // (a) MARKET order filled and was removed, or
        // (b) MARKET order had no liquidity and was cancelled/removed.
        // We CANNOT distinguish these without a balance check.
        // Return CANCELLED — the executor will verify fills via balance check.
        if (res.status === 404) {
          log.warn("Predict getOrderStatus 404 — order gone (treating as CANCELLED, needs balance verification)", { orderId });
          return { orderId, status: "CANCELLED", filledSize: 0, remainingSize: 0 };
        }
        log.warn("Predict getOrderStatus failed", { orderId, status: res.status });
        return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 };
      }

      const data = (await res.json()) as Record<string, unknown>;
      const rawStatus = String(data.status ?? "UNKNOWN").toUpperCase();

      const status: OrderStatus = (() => {
        switch (rawStatus) {
          case "MATCHED":
          case "FILLED":
            return "FILLED";
          case "LIVE":
          case "OPEN":
            return "OPEN";
          case "PARTIAL":
          case "PARTIALLY_FILLED":
            return "PARTIAL";
          case "CANCELLED":
          case "CANCELED":
            return "CANCELLED";
          case "EXPIRED":
            return "EXPIRED";
          default:
            return "UNKNOWN";
        }
      })();

      const filledSize = Number(data.filledSize ?? data.filled_size ?? 0);
      const originalSize = Number(data.size ?? data.originalSize ?? 0);

      return {
        orderId,
        status,
        filledSize,
        remainingSize: Math.max(0, originalSize - filledSize),
      };
    } catch (err) {
      log.error("Predict getOrderStatus error", { orderId, error: String(err) });
      return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 };
    }
  }

  async ensureApprovals(publicClient: PublicClient): Promise<void> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account");

    // Approve all CTF contracts for their corresponding exchanges
    for (const { ctf, exchanges } of CTF_EXCHANGE_PAIRS) {
      for (const exchange of exchanges) {
        try {
          const approved = await publicClient.readContract({
            address: ctf,
            abi: ERC1155_ABI,
            functionName: "isApprovedForAll",
            args: [account.address, exchange],
          });
          if (!approved) {
            log.warn("Predict CTF (ERC-1155) not approved — sending setApprovalForAll", {
              ctf, exchange, owner: account.address,
            });
            try {
              const txHash = await this.walletClient.writeContract({
                account,
                address: ctf,
                abi: ERC1155_SET_APPROVAL_ABI,
                functionName: "setApprovalForAll",
                args: [exchange, true],
                chain: this.walletClient.chain,
              });
              log.info("Predict CTF setApprovalForAll tx sent, waiting for confirmation", { txHash });
              const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
              if (receipt.status === "reverted") {
                log.error("Predict CTF setApprovalForAll reverted", { txHash });
              } else {
                log.info("Predict CTF setApprovalForAll confirmed", { txHash, blockNumber: receipt.blockNumber });
              }
            } catch (txErr) {
              log.error("Failed to send CTF setApprovalForAll tx", { error: String(txErr) });
            }
          } else {
            log.info("Predict CTF (ERC-1155) approval OK", { ctf, exchange });
          }
        } catch (err) {
          log.error("Failed to check Predict CTF approval", { ctf, exchange, error: String(err) });
        }
      }
    }

    // Approve USDT for all exchange contracts
    for (const exchange of ALL_PREDICT_EXCHANGES) {
      try {
        const allowance = await publicClient.readContract({
          address: BSC_USDT_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account.address, exchange],
        });
        if (allowance === 0n) {
          log.warn("Predict USDT allowance is zero — sending approve", {
            usdt: BSC_USDT_ADDRESS, exchange, owner: account.address,
          });
          try {
            const txHash = await this.walletClient.writeContract({
              account,
              address: BSC_USDT_ADDRESS,
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [exchange, 2n ** 256n - 1n],
              chain: this.walletClient.chain,
            });
            log.info("Predict USDT approve tx sent, waiting for confirmation", { txHash });
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
            if (receipt.status === "reverted") {
              log.error("Predict USDT approve reverted", { txHash });
            } else {
              log.info("Predict USDT approve confirmed", { txHash, blockNumber: receipt.blockNumber });
            }
          } catch (txErr) {
            log.error("Failed to send USDT approve tx", { error: String(txErr) });
          }
        } else {
          log.info("Predict USDT allowance OK", { exchange, allowance: allowance.toString() });
        }
      } catch (err) {
        log.error("Failed to check Predict USDT allowance", { exchange, error: String(err) });
      }
    }
  }
}
