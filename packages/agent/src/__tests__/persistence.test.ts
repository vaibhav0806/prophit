import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { saveState, loadState, type PersistedState } from "../persistence.js";
import type { Position } from "../types.js";

const STATE_FILE = "agent-state.json";

function cleanup() {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
  }
}

const samplePosition: Position = {
  positionId: 1,
  adapterA: "0x1111111111111111111111111111111111111111",
  adapterB: "0x2222222222222222222222222222222222222222",
  marketIdA: "0x0000000000000000000000000000000000000000000000000000000000000001",
  marketIdB: "0x0000000000000000000000000000000000000000000000000000000000000002",
  boughtYesOnA: true,
  sharesA: 1000000000000000000n,
  sharesB: 2000000000000000000n,
  costA: 500000n,
  costB: 400000n,
  openedAt: 1700000000n,
  closed: false,
};

describe("persistence", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("saves and loads state correctly", () => {
    const state: PersistedState = {
      tradesExecuted: 5,
      positions: [samplePosition],
      lastScan: 1700000000000,
    };

    saveState(state);
    const loaded = loadState();

    expect(loaded).not.toBeNull();
    expect(loaded!.tradesExecuted).toBe(5);
    expect(loaded!.lastScan).toBe(1700000000000);
    expect(loaded!.positions).toHaveLength(1);
  });

  it("correctly serializes and deserializes bigints", () => {
    const state: PersistedState = {
      tradesExecuted: 1,
      positions: [samplePosition],
      lastScan: 0,
    };

    saveState(state);
    const loaded = loadState();

    expect(loaded).not.toBeNull();
    const pos = loaded!.positions[0];
    expect(pos.sharesA).toBe(1000000000000000000n);
    expect(pos.sharesB).toBe(2000000000000000000n);
    expect(pos.costA).toBe(500000n);
    expect(pos.costB).toBe(400000n);
    expect(pos.openedAt).toBe(1700000000n);
  });

  it("returns null when file does not exist", () => {
    const loaded = loadState();
    expect(loaded).toBeNull();
  });

  it("returns null when file contains invalid JSON", () => {
    writeFileSync(STATE_FILE, "this is not json{{{", "utf-8");
    const loaded = loadState();
    expect(loaded).toBeNull();
  });

  it("handles missing fields gracefully", () => {
    writeFileSync(STATE_FILE, JSON.stringify({}), "utf-8");
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded!.tradesExecuted).toBe(0);
    expect(loaded!.positions).toEqual([]);
    expect(loaded!.lastScan).toBe(0);
  });

  it("saves state with empty positions array", () => {
    const state: PersistedState = {
      tradesExecuted: 0,
      positions: [],
      lastScan: 0,
    };

    saveState(state);
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded!.positions).toEqual([]);
  });

  it("preserves non-bigint fields on positions", () => {
    const state: PersistedState = {
      tradesExecuted: 0,
      positions: [samplePosition],
      lastScan: 0,
    };

    saveState(state);
    const loaded = loadState();

    const pos = loaded!.positions[0];
    expect(pos.positionId).toBe(1);
    expect(pos.adapterA).toBe("0x1111111111111111111111111111111111111111");
    expect(pos.boughtYesOnA).toBe(true);
    expect(pos.closed).toBe(false);
  });
});
