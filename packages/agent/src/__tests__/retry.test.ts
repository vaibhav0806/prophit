import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry.js";

// Silence logger output during tests
vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withRetry(fn, { retries: 3, delayMs: 1 });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { retries: 3, delayMs: 1, label: "test-op" });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after all retries exhausted", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.reject(new Error("always fails"));
    });

    await expect(
      withRetry(fn, { retries: 2, delayMs: 1, label: "failing-op" }),
    ).rejects.toThrow("always fails");
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("uses exponential backoff delays", async () => {
    const timestamps: number[] = [];
    const fn = vi.fn().mockImplementation(() => {
      timestamps.push(Date.now());
      if (timestamps.length < 3) {
        return Promise.reject(new Error("fail"));
      }
      return Promise.resolve("ok");
    });

    const result = await withRetry(fn, { retries: 3, delayMs: 50, label: "backoff-test" });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);

    // 1st retry delay should be ~50ms (50 * 2^0)
    const delay1 = timestamps[1] - timestamps[0];
    expect(delay1).toBeGreaterThanOrEqual(40);
    expect(delay1).toBeLessThan(200);

    // 2nd retry delay should be ~100ms (50 * 2^1)
    const delay2 = timestamps[2] - timestamps[1];
    expect(delay2).toBeGreaterThanOrEqual(80);
    expect(delay2).toBeLessThan(300);
  });

  it("uses default options when none provided", async () => {
    const fn = vi.fn().mockResolvedValue("default");
    const result = await withRetry(fn);
    expect(result).toBe("default");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("works with retries=0 (no retries)", async () => {
    const fn = vi.fn().mockImplementation(() => Promise.reject(new Error("no retries")));

    await expect(withRetry(fn, { retries: 0 })).rejects.toThrow("no retries");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
