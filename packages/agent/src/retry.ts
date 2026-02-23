import { log } from "./logger.js";

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const { retries = 3, delayMs = 1000, label = "operation" } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = delayMs * 2 ** attempt;
        log.warn(`${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, { error: String(err) });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
