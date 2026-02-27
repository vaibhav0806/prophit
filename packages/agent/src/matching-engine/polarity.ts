// ---------------------------------------------------------------------------
// Polarity detection — detects when two market titles express the same event
// with inverted YES/NO semantics (e.g. "above $50" vs "below $50").
// Pure function, no side effects.
// ---------------------------------------------------------------------------

import { normalizeTitle } from "./normalizer.js";

export interface PolarityResult {
  polarityFlip: boolean;
  confidence: number;
}

// Antonym pairs — if title A contains one side and title B the other,
// polarity is likely flipped. Order: [positive, negative].
const ANTONYM_PAIRS: [string, string][] = [
  ["above", "below"],
  ["over", "under"],
  ["more", "fewer"],
  ["more", "less"],
  ["higher", "lower"],
  ["rise", "fall"],
  ["gain", "lose"],
  ["yes", "no"],
  ["win", "lose"],
  ["pass", "fail"],
  ["approve", "reject"],
  ["increase", "decrease"],
  ["exceed", "fall short"],
  ["bull", "bear"],
];

// Negation words — if one title contains a negation the other doesn't, flip.
const NEGATION_WORDS = new Set([
  "not", "no", "never", "neither", "nor", "without", "won't", "wont",
  "don't", "dont", "doesn't", "doesnt", "isn't", "isnt", "aren't", "arent",
  "can't", "cant", "cannot", "won't", "wont", "fail", "unable",
]);

/**
 * Detect if two markets have flipped polarity (YES on A = NO on B).
 *
 * Checks:
 * 1. Outcome label inversion (if labels are provided)
 * 2. Negation asymmetry (one title has negation, the other doesn't)
 * 3. Antonym pairs in titles
 *
 * Returns { polarityFlip: false, confidence: 0 } when no flip detected.
 */
export function detectPolarity(
  titleA: string,
  titleB: string,
  outcomeLabelsA?: [string, string],
  outcomeLabelsB?: [string, string],
): PolarityResult {
  // --- Check 1: Outcome label inversion ---
  if (outcomeLabelsA && outcomeLabelsB) {
    const [yesA, noA] = outcomeLabelsA.map((l) => l.toLowerCase().trim());
    const [yesB, noB] = outcomeLabelsB.map((l) => l.toLowerCase().trim());

    // If A's YES label matches B's NO label (or vice versa), it's a flip
    if (yesA === noB && noA === yesB) {
      return { polarityFlip: true, confidence: 0.95 };
    }
  }

  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);
  const wordsA = new Set(normA.split(" ").filter(Boolean));
  const wordsB = new Set(normB.split(" ").filter(Boolean));

  // --- Check 2: Negation asymmetry ---
  const negA = countNegations(wordsA);
  const negB = countNegations(wordsB);

  // One has negation, the other doesn't → likely flipped
  if ((negA > 0) !== (negB > 0)) {
    // Verify the rest of the title is similar enough (>60% overlap after
    // removing negation words) to avoid false positives on unrelated titles
    const cleanA = new Set([...wordsA].filter((w) => !NEGATION_WORDS.has(w)));
    const cleanB = new Set([...wordsB].filter((w) => !NEGATION_WORDS.has(w)));
    const overlap = setOverlap(cleanA, cleanB);
    if (overlap >= 0.6) {
      return { polarityFlip: true, confidence: 0.85 };
    }
  }

  // --- Check 3: Antonym pairs ---
  for (const [pos, neg] of ANTONYM_PAIRS) {
    const aHasPos = wordsA.has(pos);
    const aHasNeg = wordsA.has(neg);
    const bHasPos = wordsB.has(pos);
    const bHasNeg = wordsB.has(neg);

    // A has positive + B has negative, or A has negative + B has positive
    if ((aHasPos && bHasNeg && !aHasNeg && !bHasPos) ||
        (aHasNeg && bHasPos && !aHasPos && !bHasNeg)) {
      // Verify rest of title overlaps
      const cleanA = new Set([...wordsA].filter((w) => w !== pos && w !== neg));
      const cleanB = new Set([...wordsB].filter((w) => w !== pos && w !== neg));
      const overlap = setOverlap(cleanA, cleanB);
      if (overlap >= 0.6) {
        return { polarityFlip: true, confidence: 0.75 };
      }
    }
  }

  return { polarityFlip: false, confidence: 0 };
}

function countNegations(words: Set<string>): number {
  let count = 0;
  for (const w of words) {
    if (NEGATION_WORDS.has(w)) count++;
  }
  return count;
}

function setOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
