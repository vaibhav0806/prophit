import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runDiscovery, type DiscoveredMarket, type DiscoveryResult } from "../discovery/pipeline.js";
import {
  matchMarkets,
  extractTemplate,
  compositeSimilarity,
  normalizeCategory,
  SIMILARITY_THRESHOLD,
  TEMPORAL_WINDOW_MS,
  type MatchResult,
  type MarketInput,
} from "../matching-engine/index.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROBABLE_EVENTS_API_BASE =
  process.env.PROBABLE_EVENTS_API_BASE || "https://market-api.probable.markets";
const PREDICT_API_BASE =
  process.env.PREDICT_API_BASE || "https://api.predict.fun";
const PREDICT_API_KEY = process.env.PREDICT_API_KEY || "";
const OPINION_API_BASE =
  process.env.OPINION_API_BASE || "https://openapi.opinion.trade/openapi";
const OPINION_API_KEY = process.env.OPINION_API_KEY || "";

const NEAR_MISS_THRESHOLD = 0.50;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data/eval");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMarketInput(m: DiscoveredMarket): MarketInput {
  return {
    id: m.id,
    title: m.title,
    conditionId: m.conditionId,
    category: m.category,
    resolvesAt: m.resolvesAt ? new Date(m.resolvesAt).getTime() : undefined,
  };
}

type PlatformName = "Probable" | "Predict" | "Opinion";

interface PairConfig {
  nameA: PlatformName;
  nameB: PlatformName;
  listA: DiscoveredMarket[];
  listB: DiscoveredMarket[];
}

interface NearMiss {
  similarity: number;
  marketA: DiscoveredMarket;
  marketB: DiscoveredMarket;
  blockReason: string;
}

function diagnoseBlockReason(a: MarketInput, b: MarketInput): string {
  const tplA = extractTemplate(a.title);
  const tplB = extractTemplate(b.title);

  // Template guard
  if (tplA && tplB && tplA.template === tplB.template) {
    return `BLOCKED: template guard — same template "${tplA.template}", different params (${tplA.entity}/${tplA.params} vs ${tplB.entity}/${tplB.params})`;
  }

  // Category mismatch
  const catA = normalizeCategory(a.category);
  const catB = normalizeCategory(b.category);
  if (catA && catB && catA !== catB) {
    return `BLOCKED: category mismatch — "${catA}" vs "${catB}"`;
  }

  // Temporal window
  if (a.resolvesAt != null && b.resolvesAt != null) {
    const diff = Math.abs(a.resolvesAt - b.resolvesAt);
    if (diff > TEMPORAL_WINDOW_MS) {
      const days = Math.round(diff / (24 * 60 * 60 * 1000));
      return `BLOCKED: temporal mismatch — ${days} days apart (max 30)`;
    }
  }

  const sim = compositeSimilarity(a.title, b.title);
  if (sim < SIMILARITY_THRESHOLD) {
    return `MISSED: below threshold ${SIMILARITY_THRESHOLD} (sim=${sim.toFixed(4)})`;
  }

  return "MISSED: unknown — matched to a different market, or ordering issue";
}

function computeNearMisses(
  listA: DiscoveredMarket[],
  listB: DiscoveredMarket[],
  matchedAIds: Set<string>,
  matchedBIds: Set<string>,
): NearMiss[] {
  const nearMisses: NearMiss[] = [];
  const unmatchedA = listA.filter((m) => !matchedAIds.has(m.id));
  const unmatchedB = listB.filter((m) => !matchedBIds.has(m.id));

  for (const a of unmatchedA) {
    const inputA = toMarketInput(a);
    for (const b of unmatchedB) {
      const sim = compositeSimilarity(a.title, b.title);
      if (sim >= NEAR_MISS_THRESHOLD) {
        const inputB = toMarketInput(b);
        nearMisses.push({
          similarity: Math.round(sim * 10000) / 10000,
          marketA: a,
          marketB: b,
          blockReason: diagnoseBlockReason(inputA, inputB),
        });
      }
    }
  }

  nearMisses.sort((a, b) => b.similarity - a.similarity);
  return nearMisses;
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

function printPairMatches(
  nameA: PlatformName,
  nameB: PlatformName,
  matches: MatchResult[],
): void {
  const byType = { conditionId: 0, templateMatch: 0, titleSimilarity: 0 };
  for (const m of matches) byType[m.matchType]++;

  console.log(`\n=== MATCHES: ${nameA} ↔ ${nameB} (${matches.length} found) ===`);
  console.log(`  conditionId: ${byType.conditionId} | templateMatch: ${byType.templateMatch} | titleSimilarity: ${byType.titleSimilarity}`);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const tplA = extractTemplate(m.marketA.title);
    const tplSuffix = m.matchType === "templateMatch" && tplA ? `  template=${tplA.template}` : "";
    const polarity = m.polarityFlip ? "  POLARITY-FLIP" : "";
    console.log(`\n  #${i + 1} [${m.matchType}] sim=${m.similarity.toFixed(4)}${tplSuffix}${polarity}`);
    console.log(`     A: "${m.marketA.title}" (${m.marketA.id})`);
    console.log(`     B: "${m.marketB.title}" (${m.marketB.id})`);
  }
}

function printNearMisses(
  nameA: PlatformName,
  nameB: PlatformName,
  nearMisses: NearMiss[],
): void {
  console.log(`\n=== NEAR MISSES: ${nameA} ↔ ${nameB} (sim >= ${NEAR_MISS_THRESHOLD}, ${nearMisses.length} found) ===`);

  const top = nearMisses.slice(0, 50); // cap output
  for (const nm of top) {
    console.log(`\n  sim=${nm.similarity.toFixed(4)} [${nm.blockReason}]`);
    console.log(`     A: "${nm.marketA.title}" (${nm.marketA.id}, cat=${nm.marketA.category ?? "none"})`);
    console.log(`     B: "${nm.marketB.title}" (${nm.marketB.id}, cat=${nm.marketB.category ?? "none"})`);
  }

  if (nearMisses.length > 50) {
    console.log(`\n  ... and ${nearMisses.length - 50} more near misses`);
  }
}

function printUnmatchedSamples(
  name: PlatformName,
  markets: DiscoveredMarket[],
  matchedIds: Set<string>,
  allOtherMarkets: DiscoveredMarket[],
): void {
  const unmatched = markets.filter((m) => !matchedIds.has(m.id));
  console.log(`\n  ${name} (${unmatched.length} unmatched):`);

  // For each unmatched market, find best similarity against all other platform markets
  const samples = unmatched.slice(0, 20);
  for (const m of samples) {
    let bestSim = 0;
    for (const o of allOtherMarkets) {
      const sim = compositeSimilarity(m.title, o.title);
      if (sim > bestSim) bestSim = sim;
    }
    console.log(`    "${m.title}" (id=${m.id}, cat=${m.category ?? "none"}, best_sim=${bestSim.toFixed(2)})`);
  }

  if (unmatched.length > 20) {
    console.log(`    ... and ${unmatched.length - 20} more`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!PREDICT_API_KEY) {
    console.error(
      "PREDICT_API_KEY env var required.\n" +
        "Usage: PREDICT_API_KEY=xxx [OPINION_API_KEY=xxx] pnpm eval",
    );
    process.exit(1);
  }

  // 1. Fetch markets
  console.log("Fetching markets from all platforms...");
  const discovery: DiscoveryResult = await runDiscovery({
    probableEventsApiBase: PROBABLE_EVENTS_API_BASE,
    predictApiBase: PREDICT_API_BASE,
    predictApiKey: PREDICT_API_KEY,
    opinionApiBase: OPINION_API_KEY ? OPINION_API_BASE : undefined,
    opinionApiKey: OPINION_API_KEY || undefined,
  });

  const probable = discovery.probableMarketsList;
  const predict = discovery.predictMarketsList;
  const opinion = discovery.opinionMarketsList ?? [];

  // 2. Save snapshot
  await mkdir(DATA_DIR, { recursive: true });
  const snapshotPath = join(DATA_DIR, "snapshot.json");
  await writeFile(
    snapshotPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        probable: probable.map((m) => ({ id: m.id, title: m.title, conditionId: m.conditionId, category: m.category, resolvesAt: m.resolvesAt })),
        predict: predict.map((m) => ({ id: m.id, title: m.title, conditionId: m.conditionId, category: m.category, resolvesAt: m.resolvesAt })),
        opinion: opinion.map((m) => ({ id: m.id, title: m.title, conditionId: m.conditionId, category: m.category, resolvesAt: m.resolvesAt })),
      },
      null,
      2,
    ),
  );
  console.log(`Snapshot saved to ${snapshotPath}`);

  // 3. Run matching on each platform pair
  const pairs: PairConfig[] = [
    { nameA: "Probable", nameB: "Predict", listA: probable, listB: predict },
    { nameA: "Opinion", nameB: "Predict", listA: opinion, listB: predict },
    { nameA: "Opinion", nameB: "Probable", listA: opinion, listB: probable },
  ];

  console.log("\n=== MARKET COUNTS ===");
  console.log(`Probable: ${probable.length} | Predict: ${predict.length} | Opinion: ${opinion.length}`);

  const allMatchedIds: Record<PlatformName, Set<string>> = {
    Probable: new Set(),
    Predict: new Set(),
    Opinion: new Set(),
  };

  let totalMatches = 0;
  const totalByType = { conditionId: 0, templateMatch: 0, titleSimilarity: 0 };
  const allNearMisses: NearMiss[] = [];

  for (const pair of pairs) {
    if (pair.listA.length === 0 || pair.listB.length === 0) {
      console.log(`\n=== MATCHES: ${pair.nameA} ↔ ${pair.nameB} — SKIPPED (empty list) ===`);
      continue;
    }

    const inputA = pair.listA.map(toMarketInput);
    const inputB = pair.listB.map(toMarketInput);

    const matches = matchMarkets(inputA, inputB);
    totalMatches += matches.length;

    const matchedAIds = new Set(matches.map((m) => m.marketA.id));
    const matchedBIds = new Set(matches.map((m) => m.marketB.id));

    // Track globally matched IDs
    for (const id of matchedAIds) allMatchedIds[pair.nameA].add(id);
    for (const id of matchedBIds) allMatchedIds[pair.nameB].add(id);

    for (const m of matches) totalByType[m.matchType]++;

    // Print matches
    printPairMatches(pair.nameA, pair.nameB, matches);

    // Compute and print near misses
    const nearMisses = computeNearMisses(pair.listA, pair.listB, matchedAIds, matchedBIds);
    allNearMisses.push(...nearMisses);
    printNearMisses(pair.nameA, pair.nameB, nearMisses);
  }

  // 4. Unmatched samples
  console.log("\n=== UNMATCHED SAMPLES (top 20 per platform) ===");

  const allOtherForProbable = [...predict, ...opinion];
  const allOtherForPredict = [...probable, ...opinion];
  const allOtherForOpinion = [...probable, ...predict];

  printUnmatchedSamples("Probable", probable, allMatchedIds.Probable, allOtherForProbable);
  printUnmatchedSamples("Predict", predict, allMatchedIds.Predict, allOtherForPredict);
  if (opinion.length > 0) {
    printUnmatchedSamples("Opinion", opinion, allMatchedIds.Opinion, allOtherForOpinion);
  }

  // 5. Summary
  const nearMissesAbove70 = allNearMisses.filter((nm) => nm.similarity >= 0.70);
  const nearMissesAbove85Blocked = allNearMisses.filter(
    (nm) => nm.similarity >= 0.85 && nm.blockReason.startsWith("BLOCKED"),
  );

  const probableMatchRate = probable.length > 0 ? Math.round((allMatchedIds.Probable.size / probable.length) * 100) : 0;
  const predictMatchRate = predict.length > 0 ? Math.round((allMatchedIds.Predict.size / predict.length) * 100) : 0;
  const opinionMatchRate = opinion.length > 0 ? Math.round((allMatchedIds.Opinion.size / opinion.length) * 100) : 0;

  console.log("\n=== SUMMARY ===");
  console.log(`  Total matches: ${totalMatches} (conditionId=${totalByType.conditionId}, template=${totalByType.templateMatch}, title=${totalByType.titleSimilarity})`);
  console.log(`  Match rates: Probable ${probableMatchRate}% (${allMatchedIds.Probable.size}/${probable.length}) | Predict ${predictMatchRate}% (${allMatchedIds.Predict.size}/${predict.length}) | Opinion ${opinionMatchRate}% (${allMatchedIds.Opinion.size}/${opinion.length})`);
  console.log(`  Near misses (>=0.70): ${nearMissesAbove70.length} — improvement opportunities`);
  console.log(`  Near misses (>=0.85 but blocked): ${nearMissesAbove85Blocked.length} — investigate these specifically`);

  if (nearMissesAbove85Blocked.length > 0) {
    console.log("\n  High-sim blocked pairs:");
    for (const nm of nearMissesAbove85Blocked) {
      console.log(`    sim=${nm.similarity.toFixed(4)} "${nm.marketA.title}" ↔ "${nm.marketB.title}"`);
      console.log(`      → ${nm.blockReason}`);
    }
  }

  console.log("\n========================================\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
