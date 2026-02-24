import { createHmac } from "node:crypto";
import type { WalletClient } from "viem";
import {
  type ClobOrder,
  type SignedClobOrder,
  ORDER_EIP712_DOMAIN,
  ORDER_EIP712_TYPES,
  CLOB_AUTH_EIP712_DOMAIN,
  CLOB_AUTH_EIP712_TYPES,
  SIDE_BUY,
  SIG_TYPE_EOA,
  ZERO_ADDRESS,
} from "./types.js";

/**
 * Build a ClobOrder from human-readable params.
 *
 * Price/size follow Polymarket convention:
 *   BUY side:  makerAmount = size (USDT you pay), takerAmount = size / price (shares you get)
 *   SELL side: makerAmount = size / price (shares you sell), takerAmount = size (USDT you get)
 *
 * All amounts are in raw units (6 decimals for USDT, but CTF uses 1e6 scaling).
 */
export function buildOrder(params: {
  maker: `0x${string}`;
  signer: `0x${string}`;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number; // USDT amount
  feeRateBps: number;
  expirationSec: number;
  nonce: bigint;
  scale?: number; // amount scaling factor (default 1e6 for Polymarket/Probable, 1e18 for Predict)
  signatureType?: number; // default SIG_TYPE_EOA (0), use SIG_TYPE_POLY_PROXY (1) for proxy wallets
}): ClobOrder {
  const { maker, signer, tokenId, side, price, size, feeRateBps, expirationSec, nonce } = params;

  // CTF CLOB amount scaling: 1e6 for Polymarket/Probable, 1e18 for Predict.fun
  // Use a two-step multiply to avoid IEEE 754 precision loss: float*1e8 stays within
  // the 53-bit mantissa (~15 digits), then BigInt handles the remaining scale factor.
  const scaleBig = BigInt(params.scale ?? 1_000_000);
  const sizeRaw = BigInt(Math.round(size * 1e8)) * scaleBig / 100_000_000n;
  const sharesRaw = BigInt(Math.round((size / price) * 1e8)) * scaleBig / 100_000_000n;

  const isBuy = side === "BUY";

  return {
    salt: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
    maker,
    signer,
    taker: ZERO_ADDRESS,
    tokenId: BigInt(tokenId),
    makerAmount: isBuy ? sizeRaw : sharesRaw,
    takerAmount: isBuy ? sharesRaw : sizeRaw,
    expiration: BigInt(Math.floor(Date.now() / 1000) + expirationSec),
    nonce,
    feeRateBps: BigInt(feeRateBps),
    side: isBuy ? SIDE_BUY : 1,
    signatureType: params.signatureType ?? SIG_TYPE_EOA,
  };
}

/**
 * Sign a ClobOrder using EIP-712 typed data via viem WalletClient.
 */
export async function signOrder(
  walletClient: WalletClient,
  order: ClobOrder,
  chainId: number,
  exchangeAddress: `0x${string}`,
  domainName?: string,
): Promise<SignedClobOrder> {
  const account = walletClient.account;
  if (!account) throw new Error("WalletClient has no account");

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: domainName ?? ORDER_EIP712_DOMAIN.name,
      version: ORDER_EIP712_DOMAIN.version,
      chainId,
      verifyingContract: exchangeAddress,
    },
    types: ORDER_EIP712_TYPES,
    primaryType: "Order",
    message: {
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
    },
  });

  return { order, signature };
}

/**
 * Sign a ClobAuth message for Polymarket-style API auth (POLY_* headers).
 * Returns the signature and the timestamp/nonce used.
 */
export async function signClobAuth(
  walletClient: WalletClient,
  chainId: number,
): Promise<{ signature: `0x${string}`; timestamp: string; nonce: bigint; address: `0x${string}` }> {
  const account = walletClient.account;
  if (!account) throw new Error("WalletClient has no account");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = 0n;
  const address = account.address;

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      ...CLOB_AUTH_EIP712_DOMAIN,
      chainId,
    },
    types: CLOB_AUTH_EIP712_TYPES,
    primaryType: "ClobAuth",
    message: {
      address,
      timestamp,
      nonce,
      message: "This message attests that I control the given wallet",
    },
  });

  return { signature, timestamp, nonce, address };
}

/**
 * Build an HMAC-SHA256 signature for L2 (API-key-based) auth.
 * Used by Polymarket-style CLOBs (Probable Markets) for order operations.
 *
 * Signing string: `${timestamp}${METHOD}${requestPath}[${body}]`
 * Secret is base64url-decoded, output is base64url with padding.
 */
export function buildHmacSignature(
  secret: string,
  timestamp: number,
  method: string,
  requestPath: string,
  body?: string,
): string {
  let message = String(timestamp) + method + requestPath;
  if (body !== undefined) {
    message += body;
  }

  // Decode base64url secret to raw bytes
  const keyBuffer = Buffer.from(
    secret.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );

  const hmac = createHmac("sha256", keyBuffer);
  hmac.update(message);

  // Output as base64url with padding preserved
  const sig = hmac
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return sig;
}

/**
 * Serialize a ClobOrder to JSON-friendly format (all bigints → strings).
 */
export function serializeOrder(order: ClobOrder): Record<string, string | number> {
  return {
    salt: order.salt.toString(),
    maker: order.maker,
    signer: order.signer,
    taker: order.taker,
    tokenId: order.tokenId.toString(),
    makerAmount: order.makerAmount.toString(),
    takerAmount: order.takerAmount.toString(),
    expiration: order.expiration.toString(),
    nonce: order.nonce.toString(),
    feeRateBps: order.feeRateBps.toString(),
    side: order.side === SIDE_BUY ? "BUY" : "SELL",
    signatureType: order.signatureType,
  };
}
