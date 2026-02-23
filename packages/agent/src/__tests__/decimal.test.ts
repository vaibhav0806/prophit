import { describe, it, expect } from "vitest";
import { decimalToBigInt } from "../utils.js";

describe("decimalToBigInt", () => {
  it("converts a simple decimal to 18 decimals", () => {
    expect(decimalToBigInt("0.55", 18)).toBe(550000000000000000n);
  });

  it("converts a whole number with no fractional part", () => {
    expect(decimalToBigInt("1", 18)).toBe(1000000000000000000n);
  });

  it("converts zero", () => {
    expect(decimalToBigInt("0", 6)).toBe(0n);
  });

  it("converts 0.0 to 0", () => {
    expect(decimalToBigInt("0.0", 18)).toBe(0n);
  });

  it("truncates excess fractional digits", () => {
    // "0.123456789" with 6 decimals should give 123456
    expect(decimalToBigInt("0.123456789", 6)).toBe(123456n);
  });

  it("pads short fractional parts", () => {
    // "0.1" with 6 decimals should give 100000
    expect(decimalToBigInt("0.1", 6)).toBe(100000n);
  });

  it("handles size values with 6 decimals", () => {
    expect(decimalToBigInt("100.5", 6)).toBe(100500000n);
  });

  it("handles price near 1.0 with 18 decimals", () => {
    expect(decimalToBigInt("0.999999999999999999", 18)).toBe(999999999999999999n);
  });

  it("handles price of exactly 1 with 18 decimals", () => {
    expect(decimalToBigInt("1.0", 18)).toBe(1000000000000000000n);
  });

  it("avoids float precision issues that Number would cause", () => {
    // Number("0.1") * 1e18 = 100000000000000000 (off by a few)
    // Our string-based approach should give exactly 100000000000000000
    expect(decimalToBigInt("0.1", 18)).toBe(100000000000000000n);
  });

  it("handles large whole numbers", () => {
    expect(decimalToBigInt("1000000", 6)).toBe(1000000000000n);
  });
});
