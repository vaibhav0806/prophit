import "dotenv/config"
import { runDiscovery } from "../discovery/pipeline.js"
import type { DiscoveredMarket, MarketMatch } from "../discovery/pipeline.js"

async function main() {
  const result = await runDiscovery({
    probableEventsApiBase: process.env.PROBABLE_EVENTS_API_BASE || "https://market-api.probable.markets",
    predictApiBase: process.env.PREDICT_API_BASE || "https://api.predict.fun",
    predictApiKey: process.env.PREDICT_API_KEY || "",
  })

  const matchedProbableIds = new Set(result.matches.map(m => m.probable.id))
  const matchedPredictIds = new Set(result.matches.map(m => m.predict.id))

  const byCondition = result.matches.filter(m => m.matchType === "conditionId")
  const byTemplate = result.matches.filter(m => m.matchType === "templateMatch")
  const byTitle = result.matches.filter(m => m.matchType === "titleSimilarity")

  const unmatchedProbable = result.probableMarketsList.filter(m => !matchedProbableIds.has(m.id))
  const unmatchedPredict = result.predictMarketsList.filter(m => !matchedPredictIds.has(m.id))

  // --- Summary ---
  console.log("\n========================================")
  console.log(" Discovery Dry Run")
  console.log("========================================\n")
  console.log(`Probable markets:  ${result.probableMarkets}`)
  console.log(`Predict markets:   ${result.predictMarkets}`)
  console.log(`Total matches:     ${result.matches.length}`)
  console.log(`  by conditionId:  ${byCondition.length}`)
  console.log(`  by template:     ${byTemplate.length}`)
  console.log(`  by title (≥85%): ${byTitle.length}`)
  console.log(`Unmatched Probable: ${unmatchedProbable.length}`)
  console.log(`Unmatched Predict:  ${unmatchedPredict.length}`)

  // --- Matched by conditionId ---
  if (byCondition.length > 0) {
    console.log("\n--- Matched by conditionId (" + byCondition.length + ") ---\n")
    for (const m of byCondition) {
      printMatch(m)
    }
  }

  // --- Matched by template ---
  if (byTemplate.length > 0) {
    console.log("\n--- Matched by template (" + byTemplate.length + ") ---\n")
    for (const m of byTemplate) {
      printMatch(m)
    }
  }

  // --- Matched by title similarity ---
  if (byTitle.length > 0) {
    console.log("\n--- Matched by title similarity (" + byTitle.length + ") ---\n")
    byTitle.sort((a, b) => b.similarity - a.similarity)
    for (const m of byTitle) {
      printMatch(m)
    }
  }

  // --- Unmatched Probable ---
  if (unmatchedProbable.length > 0) {
    console.log("\n--- Unmatched Probable (" + unmatchedProbable.length + ") ---\n")
    for (const m of unmatchedProbable) {
      printMarket(m)
    }
  }

  // --- Unmatched Predict ---
  if (unmatchedPredict.length > 0) {
    console.log("\n--- Unmatched Predict (" + unmatchedPredict.length + ") ---\n")
    for (const m of unmatchedPredict) {
      printMarket(m)
    }
  }
}

function printMatch(m: MarketMatch) {
  const pct = (m.similarity * 100).toFixed(0)
  console.log(`  [${pct}%] ${m.probable.title}`)
  if (m.probable.title !== m.predict.title) {
    console.log(`    Predict: ${m.predict.title}`)
  }
  console.log(`    Probable #${m.probable.id} | Predict #${m.predict.id}`)
  console.log("")
}

function printMarket(m: DiscoveredMarket) {
  const cat = m.category ? ` [${m.category}]` : ""
  console.log(`  #${m.id}${cat} ${m.title}`)
}

main().catch(console.error)
