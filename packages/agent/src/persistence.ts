import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { log } from "./logger.js";
import type { Position } from "./types.js";

const STATE_FILE = process.env.STATE_FILE_PATH || path.join(process.cwd(), "agent-state.json");

export interface PersistedState {
  tradesExecuted: number;
  positions: Position[];
  lastScan: number;
}

const BIGINT_FIELDS: ReadonlySet<string> = new Set([
  "sharesA",
  "sharesB",
  "costA",
  "costB",
  "openedAt",
]);

function serialize(state: PersistedState): string {
  return JSON.stringify(state, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

function revivePosition(raw: Record<string, unknown>): Position {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (BIGINT_FIELDS.has(key) && typeof value === "string") {
      out[key] = BigInt(value);
    } else {
      out[key] = value;
    }
  }
  return out as unknown as Position;
}

export function saveState(state: PersistedState): void {
  try {
    const tmpFile = STATE_FILE + ".tmp";
    writeFileSync(tmpFile, serialize(state), "utf-8");
    renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    log.error("Failed to save state", { error: String(err) });
  }
}

export function loadState(): PersistedState | null {
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      tradesExecuted: parsed.tradesExecuted ?? 0,
      positions: Array.isArray(parsed.positions)
        ? parsed.positions.map(revivePosition)
        : [],
      lastScan: parsed.lastScan ?? 0,
    };
  } catch {
    log.warn("Could not load persisted state, starting fresh");
    return null;
  }
}
