import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentStatus, ArbitOpportunity, Position, ClobPosition } from "../types.js";
import type { ConfigUpdate } from "../api/server.js";

// Mock config module (it reads process.env at import time)
vi.mock("../config.js", () => ({
  config: {
    apiKey: "",
    probableEventsApiBase: "https://api.test",
    predictApiBase: "https://api.test",
    predictApiKey: "key",
  },
}));

// Import after mocking
import { createServer } from "../api/server.js";
import { config } from "../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE = 10n ** 18n;

const mockStatus: AgentStatus = {
  running: true,
  lastScan: Date.now(),
  tradesExecuted: 5,
  uptime: 60000,
  config: {
    minSpreadBps: 100,
    maxSpreadBps: 400,
    maxPositionSize: "500000000",
    scanIntervalMs: 5000,
    executionMode: "clob",
  },
};

const mockOpportunity: ArbitOpportunity = {
  marketId: "0x01" as `0x${string}`,
  protocolA: "probable",
  protocolB: "predict",
  buyYesOnA: true,
  yesPriceA: ONE / 2n,
  noPriceB: ONE / 2n,
  totalCost: ONE,
  guaranteedPayout: ONE,
  spreadBps: 500,
  grossSpreadBps: 500,
  feesDeducted: 0n,
  estProfit: 50_000_000n,
  liquidityA: ONE,
  liquidityB: ONE,
};

let startAgent: ReturnType<typeof vi.fn>;
let stopAgent: ReturnType<typeof vi.fn>;
let updateConfig: ReturnType<typeof vi.fn>;
let getYieldStatus: ReturnType<typeof vi.fn>;
let getClobPositions: ReturnType<typeof vi.fn>;

function createApp(opts?: { withApiKey?: string; withYield?: boolean }) {
  if (opts?.withApiKey) {
    (config as any).apiKey = opts.withApiKey;
  } else {
    (config as any).apiKey = "";
  }

  startAgent = vi.fn();
  stopAgent = vi.fn();
  updateConfig = vi.fn();
  getYieldStatus = opts?.withYield ? vi.fn().mockReturnValue({ positions: [] }) : undefined as any;
  getClobPositions = vi.fn().mockReturnValue([]);

  return createServer(
    () => mockStatus,
    () => [mockOpportunity],
    () => [],
    startAgent,
    stopAgent,
    updateConfig,
    getYieldStatus || undefined,
    getClobPositions,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("API server", () => {
  describe("auth middleware", () => {
    it("passes when no API key configured", async () => {
      const app = createApp();
      const res = await app.request("/api/status");
      expect(res.status).toBe(200);
    });

    it("returns 401 when API key configured but not provided", async () => {
      const app = createApp({ withApiKey: "secret123" });
      const res = await app.request("/api/status");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("unauthorized");
    });

    it("returns 401 with wrong bearer token", async () => {
      const app = createApp({ withApiKey: "secret123" });
      const res = await app.request("/api/status", {
        headers: { Authorization: "Bearer wrong" },
      });
      expect(res.status).toBe(401);
    });

    it("passes with correct bearer token", async () => {
      const app = createApp({ withApiKey: "secret123" });
      const res = await app.request("/api/status", {
        headers: { Authorization: "Bearer secret123" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/status", () => {
    it("returns agent status", async () => {
      const app = createApp();
      const res = await app.request("/api/status");
      const body = await res.json();
      expect(body.running).toBe(true);
      expect(body.tradesExecuted).toBe(5);
      expect(body.config.executionMode).toBe("clob");
    });
  });

  describe("GET /api/opportunities", () => {
    it("returns serialized opportunities with bigints as strings", async () => {
      const app = createApp();
      const res = await app.request("/api/opportunities");
      const body = await res.json() as any[];
      expect(body).toHaveLength(1);
      expect(body[0].spreadBps).toBe(500);
      // BigInt fields should be serialized as strings
      expect(typeof body[0].yesPriceA).toBe("string");
      expect(typeof body[0].estProfit).toBe("string");
    });
  });

  describe("GET /api/positions", () => {
    it("returns serialized positions", async () => {
      const app = createApp();
      const res = await app.request("/api/positions");
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("GET /api/clob-positions", () => {
    it("returns CLOB positions", async () => {
      const app = createApp();
      const res = await app.request("/api/clob-positions");
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("POST /api/agent/start", () => {
    it("calls startAgent and returns ok", async () => {
      const app = createApp();
      const res = await app.request("/api/agent/start", { method: "POST" });
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(startAgent).toHaveBeenCalled();
    });
  });

  describe("POST /api/agent/stop", () => {
    it("calls stopAgent and returns ok", async () => {
      const app = createApp();
      const res = await app.request("/api/agent/stop", { method: "POST" });
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(stopAgent).toHaveBeenCalled();
    });
  });

  describe("GET /api/yield", () => {
    it("returns 404 when yield not enabled", async () => {
      const app = createApp({ withYield: false });
      const res = await app.request("/api/yield");
      expect(res.status).toBe(404);
    });

    it("returns yield data when enabled", async () => {
      const app = createApp({ withYield: true });
      const res = await app.request("/api/yield");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("positions");
    });
  });

  describe("POST /api/config", () => {
    it("calls updateConfig and returns ok", async () => {
      const app = createApp();
      const res = await app.request("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minSpreadBps: 200 }),
      });
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(updateConfig).toHaveBeenCalledWith({ minSpreadBps: 200 });
    });

    it("returns 400 when updateConfig throws", async () => {
      const app = createApp();
      updateConfig.mockImplementation(() => { throw new Error("Invalid config"); });
      const res = await app.request("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minSpreadBps: -1 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid config");
    });
  });
});
