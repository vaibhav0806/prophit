/** Convert a decimal string like "0.55" to a bigint with the given decimal places. */
export function decimalToBigInt(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.split(".");
  const paddedFrac = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole + paddedFrac);
}
