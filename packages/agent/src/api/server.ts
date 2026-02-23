import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "../config.js";
import type { AgentStatus, ArbitOpportunity, Position } from "../types.js";

/** Converts bigints to strings for JSON serialization */
function serializeBigInts<T>(obj: T): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}

export interface ConfigUpdate {
  minSpreadBps?: number;
  maxPositionSize?: string;
  scanIntervalMs?: number;
}

export function createServer(
  getStatus: () => AgentStatus,
  getOpportunities: () => ArbitOpportunity[],
  getPositions: () => Position[],
  startAgent: () => void,
  stopAgent: () => void,
  updateConfig: (update: ConfigUpdate) => void,
): Hono {
  const app = new Hono();

  // CORS for dev
  app.use("*", cors());

  // Auth middleware for all routes
  app.use("*", async (c, next) => {
    if (config.apiKey) {
      const auth = c.req.header("Authorization");
      if (auth !== `Bearer ${config.apiKey}`) {
        return c.json({ error: "unauthorized" }, 401);
      }
    }
    await next();
  });

  app.get("/api/status", (c) => {
    return c.json(getStatus());
  });

  app.get("/api/opportunities", (c) => {
    return c.json(serializeBigInts(getOpportunities()) as unknown[]);
  });

  app.get("/api/positions", (c) => {
    return c.json(serializeBigInts(getPositions()) as unknown[]);
  });

  app.post("/api/agent/start", (c) => {
    startAgent();
    return c.json({ ok: true });
  });

  app.post("/api/agent/stop", (c) => {
    stopAgent();
    return c.json({ ok: true });
  });

  app.post("/api/config", async (c) => {
    const body = await c.req.json<ConfigUpdate>();
    try {
      updateConfig(body);
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  return app;
}
