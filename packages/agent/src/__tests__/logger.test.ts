import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../logger.js";

describe("logger", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("outputs valid JSON for info", () => {
    log.info("test message");

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("test message");
    expect(parsed.ts).toBeDefined();
    expect(parsed.data).toBeUndefined();
  });

  it("outputs valid JSON for warn", () => {
    log.warn("warning message");

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("warning message");
  });

  it("outputs to stderr for error", () => {
    log.error("error message");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();

    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("error message");
  });

  it("includes data when provided", () => {
    log.info("with data", { key: "value", count: 42 });

    const output = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.data).toEqual({ key: "value", count: 42 });
  });

  it("outputs lines ending with newline", () => {
    log.info("newline check");

    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output.endsWith("\n")).toBe(true);
  });

  it("produces valid ISO timestamp", () => {
    log.info("timestamp check");

    const output = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    // Should be a valid ISO date
    const date = new Date(parsed.ts);
    expect(date.toISOString()).toBe(parsed.ts);
  });

  it("serializes bigints in data as strings", () => {
    log.info("bigint check", { amount: 12345678901234567890n as unknown as number });

    const output = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.data.amount).toBe("12345678901234567890");
  });
});
