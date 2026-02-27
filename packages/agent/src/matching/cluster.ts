import type { EmbeddedQuote } from "./embedder.js";
import type { MarketQuote } from "../types.js";
import { log } from "../logger.js";
import { normalizeCategory, TEMPORAL_WINDOW_MS } from "../matching-engine/index.js";

export interface EventCluster {
  quotes: MarketQuote[];
  similarity: number;
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Cluster embedded quotes by semantic similarity.
 * Only matches quotes from DIFFERENT protocols.
 * Returns clusters of 2+ quotes that likely refer to the same event.
 */
export function clusterByEvent(
  embedded: EmbeddedQuote[],
  threshold: number,
): EventCluster[] {
  const clusters: EventCluster[] = [];
  const used = new Set<number>();

  for (let i = 0; i < embedded.length; i++) {
    if (used.has(i)) continue;

    const cluster: EmbeddedQuote[] = [embedded[i]];
    let bestSim = 0;

    for (let j = i + 1; j < embedded.length; j++) {
      if (used.has(j)) continue;
      // Only match across different protocols
      if (embedded[i].quote.protocol === embedded[j].quote.protocol) continue;

      // Category pre-filter: skip cross-category pairs
      const catI = normalizeCategory(embedded[i].quote.category);
      const catJ = normalizeCategory(embedded[j].quote.category);
      if (catI && catJ && catI !== catJ) continue;

      // Temporal window filter
      if (embedded[i].quote.expiresAt != null && embedded[j].quote.expiresAt != null) {
        if (Math.abs(embedded[i].quote.expiresAt! - embedded[j].quote.expiresAt!) > TEMPORAL_WINDOW_MS) continue;
      }

      const sim = cosineSimilarity(embedded[i].embedding, embedded[j].embedding);
      if (sim >= threshold) {
        cluster.push(embedded[j]);
        bestSim = Math.max(bestSim, sim);
        used.add(j);
      }
    }

    if (cluster.length >= 2) {
      used.add(i);
      clusters.push({
        quotes: cluster.map((c) => c.quote),
        similarity: bestSim,
      });

      log.info("Found candidate event cluster", {
        protocols: cluster.map((c) => c.quote.protocol),
        descriptions: cluster.map((c) => c.quote.eventDescription),
        similarity: bestSim.toFixed(4),
      });
    }
  }

  return clusters;
}
