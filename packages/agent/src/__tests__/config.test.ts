import { describe, it, expect, vi, beforeEach } from "vitest";

// config.ts reads process.env at import time, so we must use dynamic imports
// with vi.resetModules() to re-execute the module with controlled env vars.

// Mock dotenv/config to prevent it from loading .env files
vi.mock("dotenv/config", () => ({}));

// Mock logger to suppress output
vi.mock("../logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function setMinimalEnv(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = {
    RPC_URL: "http://localhost:8545",
    PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    EXECUTION_MODE: "clob", // clob mode doesn't require vault addresses
    CHAIN_ID: "31337",
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) {
    process.env[k] = v;
  }
}

function clearEnv() {
  const keys = [
    "RPC_URL", "PRIVATE_KEY", "EXECUTION_MODE", "CHAIN_ID",
    "VAULT_ADDRESS", "ADAPTER_A_ADDRESS", "ADAPTER_B_ADDRESS",
    "USDT_ADDRESS", "MARKET_ID", "MIN_SPREAD_BPS", "MAX_POSITION_SIZE",
    "SCAN_INTERVAL_MS", "API_KEY", "NODE_ENV",
    "OPINION_TOKEN_MAP", "PREDICT_MARKET_MAP", "PROBABLE_MARKET_MAP",
    "YIELD_ROTATION_ENABLED", "DRY_RUN", "AUTO_DISCOVER",
    "GAS_TO_USDT_RATE", "PORT",
  ];
  for (const k of keys) {
    delete process.env[k];
  }
}

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
  });

  it("throws when RPC_URL is missing", async () => {
    setMinimalEnv();
    delete process.env.RPC_URL;
    await expect(import("../config.js")).rejects.toThrow("Missing required env var: RPC_URL");
  });

  it("throws when PRIVATE_KEY is missing", async () => {
    setMinimalEnv();
    delete process.env.PRIVATE_KEY;
    await expect(import("../config.js")).rejects.toThrow("Missing required env var: PRIVATE_KEY");
  });

  it("throws when PRIVATE_KEY is not hex", async () => {
    setMinimalEnv({ PRIVATE_KEY: "not-a-hex-key" });
    await expect(import("../config.js")).rejects.toThrow("Invalid hex for PRIVATE_KEY");
  });

  it("throws when vault mode has invalid VAULT_ADDRESS", async () => {
    setMinimalEnv({
      EXECUTION_MODE: "vault",
      VAULT_ADDRESS: "0xinvalid",
      ADAPTER_A_ADDRESS: "0x0000000000000000000000000000000000000001",
      ADAPTER_B_ADDRESS: "0x0000000000000000000000000000000000000002",
      USDT_ADDRESS: "0x0000000000000000000000000000000000000003",
      MARKET_ID: "0x01",
    });
    await expect(import("../config.js")).rejects.toThrow("Invalid address for VAULT_ADDRESS");
  });

  it("applies correct defaults", async () => {
    setMinimalEnv();
    const { config } = await import("../config.js");
    expect(config.minSpreadBps).toBe(100);
    expect(config.maxPositionSize).toBe(500_000_000n);
    expect(config.scanIntervalMs).toBe(5000);
    expect(config.chainId).toBe(31337);
    expect(config.port).toBe(3001);
    expect(config.orderExpirationSec).toBe(300);
    expect(config.fillPollIntervalMs).toBe(5000);
    expect(config.fillPollTimeoutMs).toBe(60000);
    expect(config.dailyLossLimit).toBe(50_000_000n);
    expect(config.matchingSimilarityThreshold).toBe(0.85);
    expect(config.matchingConfidenceThreshold).toBe(0.90);
  });

  it("reads custom numeric values from env", async () => {
    setMinimalEnv({
      MIN_SPREAD_BPS: "250",
      MAX_POSITION_SIZE: "1000000000",
      SCAN_INTERVAL_MS: "10000",
    });
    const { config } = await import("../config.js");
    expect(config.minSpreadBps).toBe(250);
    expect(config.maxPositionSize).toBe(1_000_000_000n);
    expect(config.scanIntervalMs).toBe(10000);
  });

  it("parses JSON maps from env", async () => {
    const tokenMap = { "0xabc": { yesTokenId: "1", noTokenId: "2", topicId: "t1" } };
    setMinimalEnv({
      OPINION_TOKEN_MAP: JSON.stringify(tokenMap),
    });
    const { config } = await import("../config.js");
    expect(config.opinionTokenMap).toEqual(tokenMap);
  });

  it("sets boolean flags correctly", async () => {
    setMinimalEnv({
      DRY_RUN: "true",
      AUTO_DISCOVER: "true",
      YIELD_ROTATION_ENABLED: "true",
    });
    const { config } = await import("../config.js");
    expect(config.dryRun).toBe(true);
    expect(config.autoDiscover).toBe(true);
    expect(config.yieldRotationEnabled).toBe(true);
  });

  it("does not require vault addresses in clob mode", async () => {
    setMinimalEnv({ EXECUTION_MODE: "clob" });
    const { config } = await import("../config.js");
    expect(config.executionMode).toBe("clob");
    expect(config.vaultAddress).toBeUndefined();
  });

  it("throws when API_KEY missing in production-like environment", async () => {
    setMinimalEnv({ CHAIN_ID: "56" }); // BSC mainnet, not local
    await expect(import("../config.js")).rejects.toThrow(
      "API_KEY must be set when running against real chains",
    );
  });
});
