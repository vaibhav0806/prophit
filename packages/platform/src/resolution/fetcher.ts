import type { Database } from "@prophet/shared/db";
import { markets } from "@prophet/shared/db";
import { eq } from "drizzle-orm";
import type { DiscoveryResult } from "@prophet/agent/src/discovery/pipeline.js";

/**
 * Sync discovery results into the markets table, populating resolution dates.
 */
export async function syncMarketsFromDiscovery(db: Database, result: DiscoveryResult): Promise<number> {
  let synced = 0;

  for (const match of result.matches) {
    const conditionId = match.probable.conditionId;
    const resolvesAt = match.probable.resolvesAt ?? match.predict.resolvesAt;

    // Upsert market
    const existing = await db.select().from(markets)
      .where(eq(markets.conditionId, conditionId))
      .limit(1);

    if (existing.length > 0) {
      await db.update(markets).set({
        title: match.probable.title || match.predict.title,
        category: match.probable.category ?? match.predict.category,
        probableMarketId: match.probable.id,
        predictMarketId: match.predict.id,
        resolvesAt: resolvesAt ? new Date(resolvesAt) : null,
        lastUpdatedAt: new Date(),
      }).where(eq(markets.conditionId, conditionId));
    } else {
      await db.insert(markets).values({
        id: crypto.randomUUID(),
        conditionId,
        title: match.probable.title || match.predict.title,
        category: match.probable.category ?? match.predict.category,
        probableMarketId: match.probable.id,
        predictMarketId: match.predict.id,
        resolvesAt: resolvesAt ? new Date(resolvesAt) : null,
      });
    }
    synced++;
  }

  return synced;
}
