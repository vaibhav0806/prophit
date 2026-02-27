// ---------------------------------------------------------------------------
// Unicode confusable mapping — ~50 common lookalikes → ASCII
// ---------------------------------------------------------------------------

/** Map of Unicode lookalikes → ASCII equivalents */
export const CONFUSABLES: Record<string, string> = {
  // Cyrillic → Latin
  "\u0410": "A", "\u0430": "a", // А а
  "\u0412": "B", "\u0432": "b", // В в (looks like B/b but is В/в)
  "\u0421": "C", "\u0441": "c", // С с
  "\u0415": "E", "\u0435": "e", // Е е
  "\u041D": "H", "\u043D": "h", // Н н
  "\u041A": "K", "\u043A": "k", // К к
  "\u041C": "M", "\u043C": "m", // М м
  "\u041E": "O", "\u043E": "o", // О о
  "\u0420": "P", "\u0440": "p", // Р р
  "\u0422": "T", "\u0442": "t", // Т т (some fonts)
  "\u0425": "X", "\u0445": "x", // Х х
  "\u0423": "Y", "\u0443": "y", // У у (loose)
  "\u0438": "n",                 // и → n (BLACKPINK: "иk" → "nk")
  "\u0418": "N",                 // И → N

  // Greek → Latin
  "\u0391": "A", "\u03B1": "a", // Α α
  "\u0392": "B", "\u03B2": "b", // Β β
  "\u0395": "E", "\u03B5": "e", // Ε ε
  "\u0397": "H", "\u03B7": "h", // Η η
  "\u0399": "I", "\u03B9": "i", // Ι ι
  "\u039A": "K", "\u03BA": "k", // Κ κ
  "\u039C": "M", "\u03BC": "m", // Μ μ
  "\u039D": "N", "\u03BD": "n", // Ν ν
  "\u039F": "O", "\u03BF": "o", // Ο ο
  "\u03A1": "P", "\u03C1": "p", // Ρ ρ
  "\u03A4": "T", "\u03C4": "t", // Τ τ
  "\u03A5": "Y", "\u03C5": "y", // Υ υ
  "\u03A7": "X", "\u03C7": "x", // Χ χ
  "\u0396": "Z", "\u03B6": "z", // Ζ ζ
  "\u039B": "A",                 // Λ → A (used as inverted V / Ʌ)
  "\u03BB": "a",                 // λ → a

  // Latin extended / special
  "\u0245": "a",                 // Ʌ (turned V) → a (BLACKPINK: "BLɅCK" → "black")
  "\u023F": "s",                 // ȿ
  "\u0186": "c",                 // Ɔ → c
  "\u0254": "c",                 // ɔ → c
  "\u018D": "d",                 // ƍ
  "\u0190": "E",                 // Ɛ
  "\u025B": "e",                 // ɛ
  "\u01B2": "V",                 // Ʋ
  "\u028B": "v",                 // ʋ

  // Fullwidth → ASCII
  "\uFF21": "A", "\uFF22": "B", "\uFF23": "C", "\uFF24": "D", "\uFF25": "E",

  // Specific known confusable: Ͻ (Greek Capital Reversed Lunate Sigma)
  "\u03FD": "c",                 // Ͻ → c (BLACKPINK: "BLɅϽK" → "black")
  "\u03FF": "c",                 // Ͽ → c (variant)
};

/**
 * Replace Unicode confusables with ASCII equivalents. O(n).
 */
export function replaceConfusables(input: string): string {
  let result = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    result += CONFUSABLES[ch] ?? ch;
  }
  return result;
}

/**
 * Full normalization pipeline for market titles.
 *
 * 1. Replace confusables → ASCII
 * 2. NFKD decomposition + strip combining marks (café → cafe)
 * 3. Collapse digit separators: "100,000" → "100000" (before punct strip)
 * 4. Lowercase
 * 5. Strip non-word/non-space
 * 6. Remove standalone current-year tokens
 * 7. Collapse whitespace + trim
 */
export function normalizeTitle(
  title: string,
  opts?: { currentYear?: number },
): string {
  const year = opts?.currentYear ?? new Date().getFullYear();

  let s = replaceConfusables(title);

  // NFKD decomposition + strip combining marks (accents)
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  // Collapse digit separators before stripping punctuation
  s = s.replace(/(\d),(\d)/g, "$1$2");

  s = s.toLowerCase();

  // Strip non-word/non-space
  s = s.replace(/[^\w\s]/g, " ");

  // Remove standalone current-year tokens
  const yearStr = String(year);
  s = s.replace(new RegExp(`\\b${yearStr}\\b`, "g"), " ");

  // Collapse whitespace + trim
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Normalize an entity name extracted from a template.
 * Applies confusable replacement + lowercase + trim + strip trailing punct.
 */
export function normalizeEntity(s: string): string {
  return replaceConfusables(s)
    .toLowerCase()
    .trim()
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/[?.,!]+$/, "");
}

/**
 * Normalize numeric magnitude suffixes to raw numbers.
 * "4B" → "4000000000", "10k" → "10000", "1.5M" → "1500000"
 * Also handles word forms: "4 billion" → "4000000000"
 */
export function normalizeMagnitude(s: string): string {
  // Suffix forms: 4B, 10k, 1.5M, 100K
  let result = s.replace(/(\d+(?:\.\d+)?)\s*([bBmMkK])\b/g, (_match, num, suffix) => {
    const n = parseFloat(num);
    const multipliers: Record<string, number> = {
      k: 1_000, K: 1_000,
      m: 1_000_000, M: 1_000_000,
      b: 1_000_000_000, B: 1_000_000_000,
    };
    return String(Math.round(n * (multipliers[suffix] ?? 1)));
  });

  // Word forms: "4 billion", "10 thousand", "1.5 million"
  result = result.replace(/(\d+(?:\.\d+)?)\s*(billion|million|thousand)/gi, (_match, num, word) => {
    const n = parseFloat(num);
    const multipliers: Record<string, number> = {
      thousand: 1_000,
      million: 1_000_000,
      billion: 1_000_000_000,
    };
    return String(Math.round(n * (multipliers[word.toLowerCase()] ?? 1)));
  });

  return result;
}

/**
 * Normalize template parameters.
 * Strip $, ?, current year, normalize magnitudes, collapse whitespace, trim.
 */
export function normalizeParams(
  s: string,
  opts?: { currentYear?: number },
): string {
  const year = opts?.currentYear ?? new Date().getFullYear();
  let result = s.toLowerCase().replace(/[$?]/g, "").replace(/\s+/g, " ").trim();
  // Collapse digit separators before magnitude normalization
  result = result.replace(/(\d),(\d)/g, "$1$2");
  // Normalize magnitude suffixes
  result = normalizeMagnitude(result);
  const yearStr = String(year);
  result = result.replace(new RegExp(`\\b${yearStr}\\b`, "g"), "");
  // Strip trailing punctuation left behind after year removal (e.g. "June 30," → "June 30")
  result = result.replace(/[,.\s]+$/, "").replace(/\s+/g, " ").trim();
  return result;
}
