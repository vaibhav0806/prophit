import { describe, it, expect, vi } from "vitest";
import { signOrder, signClobAuth, buildHmacSignature, buildOrder } from "../clob/signing.js";
import type { ClobOrder } from "../clob/types.js";

// ---------------------------------------------------------------------------
// signOrder
// ---------------------------------------------------------------------------

describe("signOrder", () => {
  function createMockWalletClient() {
    return {
      account: {
        address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      },
      signTypedData: vi.fn().mockResolvedValue("0xfakesignature" as `0x${string}`),
    } as any;
  }

  function sampleOrder(): ClobOrder {
    return buildOrder({
      maker: "0x1111111111111111111111111111111111111111",
      signer: "0x1111111111111111111111111111111111111111",
      tokenId: "12345",
      side: "BUY",
      price: 0.5,
      size: 100,
      feeRateBps: 0,
      expirationSec: 300,
      nonce: 1n,
    });
  }

  it("returns order and signature", async () => {
    const wallet = createMockWalletClient();
    const order = sampleOrder();
    const result = await signOrder(wallet, order, 56, "0xExchange" as `0x${string}`);

    expect(result.order).toBe(order);
    expect(result.signature).toBe("0xfakesignature");
  });

  it("passes correct EIP-712 domain with default name", async () => {
    const wallet = createMockWalletClient();
    const order = sampleOrder();
    await signOrder(wallet, order, 56, "0xExchange" as `0x${string}`);

    const call = wallet.signTypedData.mock.calls[0][0];
    expect(call.domain.chainId).toBe(56);
    expect(call.domain.verifyingContract).toBe("0xExchange");
    expect(call.domain.name).toBe("ClobExchange"); // default ORDER_EIP712_DOMAIN.name
    expect(call.primaryType).toBe("Order");
  });

  it("uses custom domain name when provided", async () => {
    const wallet = createMockWalletClient();
    const order = sampleOrder();
    await signOrder(wallet, order, 56, "0xExchange" as `0x${string}`, "Probable CTF Exchange");

    const call = wallet.signTypedData.mock.calls[0][0];
    expect(call.domain.name).toBe("Probable CTF Exchange");
  });

  it("throws when wallet has no account", async () => {
    const wallet = { account: undefined, signTypedData: vi.fn() } as any;
    const order = sampleOrder();
    await expect(signOrder(wallet, order, 56, "0xExchange" as `0x${string}`))
      .rejects.toThrow("WalletClient has no account");
  });
});

// ---------------------------------------------------------------------------
// signClobAuth
// ---------------------------------------------------------------------------

describe("signClobAuth", () => {
  it("returns signature, timestamp, nonce, and address", async () => {
    const wallet = {
      account: {
        address: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      },
      signTypedData: vi.fn().mockResolvedValue("0xauthsig" as `0x${string}`),
    } as any;

    const result = await signClobAuth(wallet, 56);

    expect(result.signature).toBe("0xauthsig");
    expect(result.address).toBe("0x2222222222222222222222222222222222222222");
    expect(result.nonce).toBe(0n);
    expect(Number(result.timestamp)).toBeGreaterThan(0);
  });

  it("passes ClobAuth EIP-712 types", async () => {
    const wallet = {
      account: { address: "0x2222222222222222222222222222222222222222" as `0x${string}` },
      signTypedData: vi.fn().mockResolvedValue("0x" as `0x${string}`),
    } as any;

    await signClobAuth(wallet, 56);

    const call = wallet.signTypedData.mock.calls[0][0];
    expect(call.primaryType).toBe("ClobAuth");
    expect(call.domain.chainId).toBe(56);
    expect(call.message.message).toContain("I control the given wallet");
  });

  it("throws when wallet has no account", async () => {
    const wallet = { account: undefined, signTypedData: vi.fn() } as any;
    await expect(signClobAuth(wallet, 56)).rejects.toThrow("WalletClient has no account");
  });
});

// ---------------------------------------------------------------------------
// buildHmacSignature
// ---------------------------------------------------------------------------

describe("buildHmacSignature", () => {
  // Known secret for deterministic testing (base64url encoded)
  const secret = "dGVzdHNlY3JldA"; // base64url of "testsecret"

  it("produces a non-empty base64url string", () => {
    const sig = buildHmacSignature(secret, 1700000000, "GET", "/orders");
    expect(sig.length).toBeGreaterThan(0);
    // base64url characters only
    expect(sig).toMatch(/^[A-Za-z0-9_-]+=*$/);
  });

  it("is deterministic for same inputs", () => {
    const sig1 = buildHmacSignature(secret, 1700000000, "GET", "/orders");
    const sig2 = buildHmacSignature(secret, 1700000000, "GET", "/orders");
    expect(sig1).toBe(sig2);
  });

  it("changes with different timestamp", () => {
    const sig1 = buildHmacSignature(secret, 1700000000, "GET", "/orders");
    const sig2 = buildHmacSignature(secret, 1700000001, "GET", "/orders");
    expect(sig1).not.toBe(sig2);
  });

  it("changes with different method", () => {
    const sig1 = buildHmacSignature(secret, 1700000000, "GET", "/orders");
    const sig2 = buildHmacSignature(secret, 1700000000, "POST", "/orders");
    expect(sig1).not.toBe(sig2);
  });

  it("changes with different path", () => {
    const sig1 = buildHmacSignature(secret, 1700000000, "GET", "/orders");
    const sig2 = buildHmacSignature(secret, 1700000000, "GET", "/cancel");
    expect(sig1).not.toBe(sig2);
  });

  it("includes body in signature when provided", () => {
    const sigNoBody = buildHmacSignature(secret, 1700000000, "POST", "/orders");
    const sigWithBody = buildHmacSignature(secret, 1700000000, "POST", "/orders", '{"tokenId":"1"}');
    expect(sigNoBody).not.toBe(sigWithBody);
  });

  it("handles base64url special characters in secret", () => {
    // Secret with - and _ (base64url chars)
    const urlSecret = "dGVzdC1zZWNyZXRf";
    const sig = buildHmacSignature(urlSecret, 1700000000, "GET", "/orders");
    expect(sig.length).toBeGreaterThan(0);
  });
});
