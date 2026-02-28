/** Convert a decimal string like "0.55" to a bigint with the given decimal places. */
export function decimalToBigInt(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.split(".");
  const paddedFrac = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole + paddedFrac);
}

/** Concurrency-limited parallel map. Runs up to `concurrency` workers over `items`. */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
