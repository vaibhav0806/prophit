import type { PublicClient, WalletClient } from "viem";
import { getAddress } from "viem";
import type {
  ClobClient,
  PlaceOrderParams,
  OrderResult,
  OrderStatusResult,
  OrderSide,
  OrderStatus,
} from "./types.js";
import { buildOrder, signOrder, serializeOrder } from "./signing.js";
import { log } from "../logger.js";

const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;
const OPINION_CTF_ADDRESS = "0xAD1a38cEc043e70E83a3eC30443dB285ED10D774" as `0x${string}`;
const OPINION_DOMAIN_NAME = "OPINION CTF Exchange";
const OPINION_FEE_RATE_BPS = 200;
const SCALE = 1e18;

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

// Opinion order status codes
const STATUS_OPEN = 1;
const STATUS_FILLED = 2;
const STATUS_CANCELLED = 3;
const STATUS_EXPIRED = 4;
const STATUS_FAILED = 5;

function mapOpinionStatus(status: number): OrderStatus {
  switch (status) {
    case STATUS_OPEN: return "OPEN";
    case STATUS_FILLED: return "FILLED";
    case STATUS_CANCELLED: return "CANCELLED";
    case STATUS_EXPIRED: return "EXPIRED";
    case STATUS_FAILED: return "CANCELLED"; // treat FAILED as CANCELLED
    default: return "UNKNOWN";
  }
}

/** Parse Opinion "filled" field format: "filledQty/totalQty" */
function parseFilledQty(filled: string | undefined): number | undefined {
  if (!filled) return undefined;
  const parts = filled.split("/");
  if (parts.length !== 2) return undefined;
  const qty = Number(parts[0]);
  return Number.isFinite(qty) ? qty : undefined;
}

export class OpinionClobClient implements ClobClient {
  readonly name = "Opinion";
  readonly exchangeAddress: `0x${string}`;

  private walletClient: WalletClient;
  private apiBase: string;
  private apiKey: string;
  private chainId: number;
  private expirationSec: number;
  private dryRun: boolean;
  private nonce: bigint;

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
    this.apiBase = params.apiBase.replace(/\/+$/, "");
    this.apiKey = params.apiKey;
    this.exchangeAddress = params.exchangeAddress;
    this.chainId = params.chainId;
    this.expirationSec = params.expirationSec ?? 300;
    this.dryRun = params.dryRun ?? false;
    this.nonce = 0n;
  }

  // ---------------------------------------------------------------------------
  // Auth — Opinion uses API key on every request, no session/HMAC
  // ---------------------------------------------------------------------------

  async authenticate(): Promise<void> {
    // If exchange address wasn't provided, fetch it dynamically
    if (!this.exchangeAddress || this.exchangeAddress === ("" as `0x${string}`)) {
      const addr = await this.fetchExchangeAddress();
      (this as { exchangeAddress: `0x${string}` }).exchangeAddress = addr;
    }
    log.info("Opinion client authenticated", { exchangeAddress: this.exchangeAddress });
  }

  private async fetchExchangeAddress(): Promise<`0x${string}`> {
    const res = await fetch(`${this.apiBase}/quoteToken?apikey=${this.apiKey}`, {
      headers: { apikey: this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Opinion /quoteToken failed: ${res.status}`);
    const data = await res.json() as any;
    const addr = data?.result?.ctfExchangeAddress ?? data?.ctfExchangeAddress;
    if (!addr || typeof addr !== "string") {
      throw new Error(`Opinion /quoteToken: missing ctfExchangeAddress in response`);
    }
    return getAddress(addr) as `0x${string}`;
  }

  // ---------------------------------------------------------------------------
  // Order placement
  // ---------------------------------------------------------------------------

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const account = this.walletClient.account;
    if (!account) return { success: false, error: "WalletClient has no account" };

    const isMarket = params.strategy !== "LIMIT";
    const tradingMethod = isMarket ? 1 : 2;

    if (this.dryRun) {
      log.info("Opinion DRY RUN: would place order", { ...params, tradingMethod });
      this.nonce += 1n;
      return { success: true, orderId: `opinion-dry-${Date.now()}`, status: "DRY_RUN", filledQty: params.size };
    }

    try {
      // Build order using shared signing infrastructure
      const order = buildOrder({
        maker: account.address,
        signer: account.address,
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        feeRateBps: OPINION_FEE_RATE_BPS,
        expirationSec: this.expirationSec,
        nonce: this.nonce,
        scale: SCALE,
        quantize: true,
        slippageBps: isMarket ? 100 : 0, // 1% slippage for MARKET orders
      });

      // Sign with Opinion domain
      const signed = await signOrder(
        this.walletClient,
        order,
        this.chainId,
        this.exchangeAddress,
        OPINION_DOMAIN_NAME,
      );

      const serialized = serializeOrder(order);
      const timestamp = Math.floor(Date.now() / 1000);

      // Build Opinion API body
      const body = {
        contractAddress: this.exchangeAddress,
        salt: serialized.salt,
        maker: getAddress(account.address),
        signer: getAddress(account.address),
        taker: serialized.taker,
        tokenId: serialized.tokenId,
        makerAmount: serialized.makerAmount,
        takerAmount: serialized.takerAmount,
        expiration: serialized.expiration,
        nonce: serialized.nonce,
        feeRateBps: serialized.feeRateBps,
        side: String(order.side),
        signatureType: String(order.signatureType),
        signature: signed.signature,
        sign: signed.signature, // duplicate field required by Opinion
        currencyAddress: BSC_USDT_ADDRESS,
        topicId: Number(params.marketId),
        price: isMarket ? "0" : String(params.price),
        tradingMethod,
        timestamp,
        safeRate: "0",
        orderExpTime: "0",
      };

      log.info("Opinion placing order", {
        side: params.side,
        price: params.price,
        size: params.size,
        tradingMethod,
        topicId: body.topicId,
      });

      const res = await fetch(`${this.apiBase}/order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      const json = await res.json() as any;

      if (!res.ok || json.errno !== 0) {
        const errorMsg = json?.errmsg ?? json?.message ?? `HTTP ${res.status}`;
        log.error("Opinion order failed", { status: res.status, errno: json?.errno, error: errorMsg });
        return { success: false, error: errorMsg };
      }

      const orderData = json.result?.order_data;
      const orderId = orderData?.trans_no ?? String(json.result?.orderId ?? "");
      const filledQty = parseFilledQty(orderData?.filled);
      const isFilled = orderData?.status === STATUS_FILLED;

      this.nonce += 1n;

      log.info("Opinion order placed", {
        orderId,
        status: orderData?.status,
        filled: orderData?.filled,
        filledQty,
      });

      return {
        success: true,
        orderId,
        status: isFilled ? "FILLED" : "MATCHED",
        filledQty: isFilled ? params.size : (filledQty ?? undefined),
      };
    } catch (err) {
      log.error("Opinion placeOrder exception", { error: String(err) });
      return { success: false, error: String(err) };
    }
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/order/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.apiKey,
        },
        body: JSON.stringify({ orderId }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json() as any;
      const success = res.ok && json.errno === 0;
      if (!success) {
        log.warn("Opinion cancelOrder failed", { orderId, errno: json?.errno, error: json?.errmsg });
      }
      return success;
    } catch (err) {
      log.error("Opinion cancelOrder exception", { orderId, error: String(err) });
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Open orders
  // ---------------------------------------------------------------------------

  async getOpenOrders(): Promise<Array<{ orderId: string; tokenId: string; side: OrderSide; price: number; size: number }>> {
    try {
      const res = await fetch(`${this.apiBase}/user/orders?status=${STATUS_OPEN}`, {
        headers: { apikey: this.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn("Opinion getOpenOrders failed", { status: res.status });
        return [];
      }
      const json = await res.json() as any;
      const orders = json.result?.list ?? json.result ?? [];
      return (orders as any[]).map((o: any) => ({
        orderId: String(o.trans_no ?? o.orderId ?? o.id),
        tokenId: String(o.tokenId ?? o.token_id ?? ""),
        side: (o.side === 0 || o.side === "BUY" ? "BUY" : "SELL") as OrderSide,
        price: Number(o.price ?? 0),
        size: Number(o.size ?? o.amount ?? 0),
      }));
    } catch (err) {
      log.error("Opinion getOpenOrders exception", { error: String(err) });
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Order status
  // ---------------------------------------------------------------------------

  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    try {
      const res = await fetch(`${this.apiBase}/user/orders?orderId=${orderId}`, {
        headers: { apikey: this.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 };
      }
      const json = await res.json() as any;
      const order = json.result?.list?.[0] ?? json.result;
      if (!order) {
        return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 };
      }

      const status = mapOpinionStatus(order.status);
      const filledQty = parseFilledQty(order.filled) ?? 0;
      const totalQty = order.filled ? Number(order.filled.split("/")[1] ?? 0) : 0;

      return {
        orderId,
        status,
        filledSize: filledQty,
        remainingSize: Math.max(0, totalQty - filledQty),
      };
    } catch (err) {
      log.error("Opinion getOrderStatus exception", { orderId, error: String(err) });
      return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Approvals — direct EOA (no Safe proxy)
  // ---------------------------------------------------------------------------

  async ensureApprovals(publicClient: PublicClient): Promise<void> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account");

    // ERC-1155 CTF approval for exchange
    try {
      const approved = await publicClient.readContract({
        address: OPINION_CTF_ADDRESS,
        abi: ERC1155_ABI,
        functionName: "isApprovedForAll",
        args: [account.address, this.exchangeAddress],
      });
      if (!approved) {
        log.warn("Opinion CTF (ERC-1155) not approved — sending setApprovalForAll", {
          ctf: OPINION_CTF_ADDRESS, exchange: this.exchangeAddress, owner: account.address,
        });
        const txHash = await this.walletClient.writeContract({
          account,
          address: OPINION_CTF_ADDRESS,
          abi: ERC1155_SET_APPROVAL_ABI,
          functionName: "setApprovalForAll",
          args: [this.exchangeAddress, true],
          chain: this.walletClient.chain,
        });
        log.info("Opinion CTF setApprovalForAll tx sent", { txHash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "reverted") {
          log.error("Opinion CTF setApprovalForAll reverted", { txHash });
        } else {
          log.info("Opinion CTF setApprovalForAll confirmed", { txHash, blockNumber: receipt.blockNumber });
        }
      } else {
        log.info("Opinion CTF (ERC-1155) approval OK", { ctf: OPINION_CTF_ADDRESS, exchange: this.exchangeAddress });
      }
    } catch (err) {
      log.error("Failed to check/set Opinion CTF approval", { error: String(err) });
    }

    // USDT approval for exchange
    try {
      const allowance = await publicClient.readContract({
        address: BSC_USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account.address, this.exchangeAddress],
      });
      if (allowance === 0n) {
        log.warn("Opinion USDT allowance is zero — sending approve", {
          usdt: BSC_USDT_ADDRESS, exchange: this.exchangeAddress, owner: account.address,
        });
        const txHash = await this.walletClient.writeContract({
          account,
          address: BSC_USDT_ADDRESS,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [this.exchangeAddress, 2n ** 256n - 1n],
          chain: this.walletClient.chain,
        });
        log.info("Opinion USDT approve tx sent", { txHash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "reverted") {
          log.error("Opinion USDT approve reverted", { txHash });
        } else {
          log.info("Opinion USDT approve confirmed", { txHash, blockNumber: receipt.blockNumber });
        }
      } else {
        log.info("Opinion USDT allowance OK", { exchange: this.exchangeAddress });
      }
    } catch (err) {
      log.error("Failed to check/set Opinion USDT approval", { error: String(err) });
    }
  }

  // ---------------------------------------------------------------------------
  // Nonce
  // ---------------------------------------------------------------------------

  async fetchNonce(): Promise<bigint> {
    log.info("Opinion fetchNonce: using local nonce (no server endpoint)", { nonce: this.nonce });
    return this.nonce;
  }

  getNonce(): bigint {
    return this.nonce;
  }

  setNonce(n: bigint): void {
    this.nonce = n;
  }
}
