/**
 * One-shot script to clear the old (wrong) safeProxyAddress from tradingWallets.
 * The old address was deployed via the standard Gnosis Safe factory, but Probable
 * requires a proxy from their own SafeProxyFactory.
 *
 * Usage: pnpm --filter platform exec tsx src/scripts/clear-safe-address.ts
 */
import "dotenv/config";
import { createDb } from "@prophet/shared/db";
import { tradingWallets } from "@prophet/shared/db";
import { isNotNull } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL env var");
  process.exit(1);
}

const db = createDb(databaseUrl);

const rows = await db
  .select({ id: tradingWallets.id, userId: tradingWallets.userId, safeProxyAddress: tradingWallets.safeProxyAddress })
  .from(tradingWallets)
  .where(isNotNull(tradingWallets.safeProxyAddress));

if (rows.length === 0) {
  console.log("No rows with safeProxyAddress set. Nothing to clear.");
  process.exit(0);
}

console.log(`Found ${rows.length} row(s) with safeProxyAddress:`);
for (const row of rows) {
  console.log(`  user=${row.userId}  safe=${row.safeProxyAddress}`);
}

const result = await db
  .update(tradingWallets)
  .set({ safeProxyAddress: null })
  .where(isNotNull(tradingWallets.safeProxyAddress));

console.log("Cleared safeProxyAddress for all rows.");
process.exit(0);
