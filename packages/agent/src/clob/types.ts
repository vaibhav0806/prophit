import type { Account, WalletClient, PublicClient } from "viem";

// --- EIP-712 Order struct (Polymarket standard, shared by Probable & Predict) ---

export interface ClobOrder {
  salt: bigint;
  maker: `0x${string}`;
  signer: `0x${string}`;
  taker: `0x${string}`;
  tokenId: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  expiration: bigint;
  nonce: bigint;
  feeRateBps: bigint;
  side: number; // 0 = BUY, 1 = SELL
  signatureType: number; // 0 = EOA, 1 = POLY_PROXY, 2 = POLY_GNOSIS_SAFE
}

export interface SignedClobOrder {
  order: ClobOrder;
  signature: `0x${string}`;
}

export type OrderSide = "BUY" | "SELL";

export interface PlaceOrderParams {
  tokenId: string;
  side: OrderSide;
  price: number; // 0-1 (e.g. 0.068)
  size: number; // USDT amount (e.g. 100)
  marketId?: string; // Predict.fun market ID — used to resolve per-market exchange address
  strategy?: "MARKET" | "LIMIT"; // default MARKET for arb, LIMIT for unwinds
  isFillOrKill?: boolean; // default true for MARKET, false for LIMIT
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  status?: string;
  error?: string;
  transactionHash?: string;
}

export interface ClobClient {
  readonly name: string;
  readonly exchangeAddress: `0x${string}`;

  /** Authenticate with the CLOB API (get tokens/headers) */
  authenticate(): Promise<void>;

  /** Place a limit order on the CLOB */
  placeOrder(params: PlaceOrderParams): Promise<OrderResult>;

  /** Cancel an order by ID (tokenId required for Probable) */
  cancelOrder(orderId: string, tokenId?: string): Promise<boolean>;

  /** Get current open orders */
  getOpenOrders(): Promise<Array<{ orderId: string; tokenId: string; side: OrderSide; price: number; size: number }>>;

  /** Get status of a specific order */
  getOrderStatus(orderId: string): Promise<OrderStatusResult>;

  /** Ensure ERC-1155 + USDT approvals for the exchange */
  ensureApprovals(publicClient: PublicClient, fundingThreshold?: bigint): Promise<void>;
}

// EIP-712 domain for CTF Exchange orders
export const ORDER_EIP712_DOMAIN = {
  name: "ClobExchange" as const,
  version: "1" as const,
};

export const ORDER_EIP712_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
  ],
} as const;

// CLOB Auth EIP-712 types (Polymarket-style POLY_* headers)
export const CLOB_AUTH_EIP712_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;

export const CLOB_AUTH_EIP712_DOMAIN = {
  name: "ClobAuthDomain" as const,
  version: "1" as const,
};

// Side constants
export const SIDE_BUY = 0;
export const SIDE_SELL = 1;

// SignatureType constants
export const SIG_TYPE_EOA = 0;
export const SIG_TYPE_POLY_PROXY = 1;

// Zero address for taker (open order)
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

// --- Order status types (fill polling) ---

export type OrderStatus = "OPEN" | "FILLED" | "PARTIAL" | "CANCELLED" | "EXPIRED" | "UNKNOWN";

export interface OrderStatusResult {
  orderId: string;
  status: OrderStatus;
  filledSize: number;
  remainingSize: number;
}
