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

// ---------------------------------------------------------------------------
// Entity alias mapping — canonical names for crypto tickers, team names, etc.
// Applied during title normalization so "ETH" and "Ethereum" produce the same tokens.
// ---------------------------------------------------------------------------

export const ENTITY_ALIASES: Record<string, string> = {
  // ---------------------------------------------------------------------------
  // Crypto: ticker → full name
  // ---------------------------------------------------------------------------
  eth: "ethereum",
  "eth/usd": "ethereum",
  btc: "bitcoin",
  "btc/usd": "bitcoin",
  bnb: "binance coin",
  sol: "solana",
  ada: "cardano",
  dot: "polkadot",
  avax: "avalanche",
  matic: "polygon",
  link: "chainlink",
  uni: "uniswap",
  xrp: "ripple",
  doge: "dogecoin",
  shib: "shiba inu",
  ethereum: "ethereum",
  bitcoin: "bitcoin",

  // ---------------------------------------------------------------------------
  // Stock tickers
  // ---------------------------------------------------------------------------
  tsla: "tesla",
  aapl: "apple",
  nvda: "nvidia",
  msft: "microsoft",
  googl: "google",
  amzn: "amazon",
  mstr: "microstrategy",
  vrt: "vertiv",
  pstg: "pure storage",
  cien: "ciena",

  // ---------------------------------------------------------------------------
  // Commodity codes
  // ---------------------------------------------------------------------------
  si: "silver",
  gc: "gold",
  spx: "s&p 500",

  // ---------------------------------------------------------------------------
  // Dota 2 teams
  // ---------------------------------------------------------------------------
  aur: "aurora",
  aur1: "aurora",
  aurora: "aurora",
  bb: "betboom team",
  bb4: "betboom team",
  "betboom team": "betboom team",
  tundra: "tundra esports",
  "tundra esports": "tundra esports",
  tl: "team liquid",
  liquid: "team liquid",
  "team liquid": "team liquid",
  pari: "parivision",
  prv: "parivision",
  parivision: "parivision",
  mouz: "mouz",
  xg: "xtreme gaming",
  xtreme: "xtreme gaming",
  "xtreme gaming": "xtreme gaming",
  fal: "team falcons",
  flc: "team falcons",
  fal2: "team falcons",
  "team falcons": "team falcons",
  og: "og",
  navi: "natus vincere",
  "natus vincere": "natus vincere",
  gl: "gamerlegion",
  gamerlegion: "gamerlegion",
  pain: "pain gaming",
  "pain gaming": "pain gaming",
  ts8: "team spirit",
  "team spirit": "team spirit",
  xctn: "execration",
  execration: "execration",

  // ---------------------------------------------------------------------------
  // LoL teams (LCK, LPL, LEC, LCS, CBLOL)
  // ---------------------------------------------------------------------------
  wbg: "weibo gaming",
  wb: "weibo gaming",
  "weibo gaming": "weibo gaming",
  blg: "bilibili gaming",
  "bilibili gaming": "bilibili gaming",
  tes: "top esports",
  "top esports": "top esports",
  we: "team we",
  "team we": "team we",
  bfx: "bnk fearx",
  fox1: "bnk fearx",
  "bnk fearx": "bnk fearx",
  dk: "dplus kia",
  "dplus kia": "dplus kia",
  drx: "drx",
  gen: "gen.g",
  "gen.g": "gen.g",
  t1: "t1",
  lyon: "lyon",
  ly: "lyon",
  tlaw: "team liquid",
  tl2: "team liquid",
  gx: "giantx",
  giantx: "giantx",
  kc: "karmine corp",
  "karmine corp": "karmine corp",
  fnc: "fnatic",
  fnatic: "fnatic",
  vit: "team vitality",
  "team vitality": "team vitality",
  mkoi: "movistar koi",
  "movistar koi": "movistar koi",
  g2: "g2 esports",
  "g2 esports": "g2 esports",
  c9: "cloud9",
  cloud9: "cloud9",
  dsg: "disguised",
  disguised: "disguised",
  sen: "sentinels",
  sentinels: "sentinels",
  al: "anyone's legend",
  jdg: "jd gaming",
  "jd gaming": "jd gaming",
  // CBLOL
  red: "red canids",
  "red canids": "red canids",
  fur: "furia",
  furia: "furia",

  // ---------------------------------------------------------------------------
  // Valorant teams
  // ---------------------------------------------------------------------------
  prx: "paper rex",
  "paper rex": "paper rex",
  nrg: "nrg esports",
  "nrg esports": "nrg esports",
  m8: "m80",
  m80: "m80",
  edg: "edward gaming",
  "edward gaming": "edward gaming",

  // ---------------------------------------------------------------------------
  // CS2 teams
  // ---------------------------------------------------------------------------
  ast: "astralis",
  astralis: "astralis",
  faze: "faze",
  heroic: "heroic",
  mglz: "themongolz",
  themongolz: "themongolz",
  vitality: "vitality",
  b8: "b8",
  "fut esports": "fut esports",

  // ---------------------------------------------------------------------------
  // NBA teams (30 teams — full names, nicknames, 3-letter codes)
  // ---------------------------------------------------------------------------
  // Full names (identity mappings prevent double-expansion)
  "atlanta hawks": "atlanta hawks",
  "boston celtics": "boston celtics",
  "brooklyn nets": "brooklyn nets",
  "charlotte hornets": "charlotte hornets",
  "chicago bulls": "chicago bulls",
  "cleveland cavaliers": "cleveland cavaliers",
  "dallas mavericks": "dallas mavericks",
  "denver nuggets": "denver nuggets",
  "detroit pistons": "detroit pistons",
  "golden state warriors": "golden state warriors",
  "houston rockets": "houston rockets",
  "indiana pacers": "indiana pacers",
  "la clippers": "los angeles clippers",
  "los angeles clippers": "los angeles clippers",
  "los angeles lakers": "los angeles lakers",
  "memphis grizzlies": "memphis grizzlies",
  "miami heat": "miami heat",
  "milwaukee bucks": "milwaukee bucks",
  "minnesota timberwolves": "minnesota timberwolves",
  "new orleans pelicans": "new orleans pelicans",
  "new york knicks": "new york knicks",
  "oklahoma city thunder": "oklahoma city thunder",
  "orlando magic": "orlando magic",
  "philadelphia 76ers": "philadelphia 76ers",
  "phoenix suns": "phoenix suns",
  "portland trail blazers": "portland trail blazers",
  "sacramento kings": "sacramento kings",
  "san antonio spurs": "san antonio spurs",
  "toronto raptors": "toronto raptors",
  "utah jazz": "utah jazz",
  "washington wizards": "washington wizards",
  // Nicknames
  hawks: "atlanta hawks",
  celtics: "boston celtics",
  nets: "brooklyn nets",
  hornets: "charlotte hornets",
  bulls: "chicago bulls",
  cavaliers: "cleveland cavaliers",
  cavs: "cleveland cavaliers",
  mavericks: "dallas mavericks",
  mavs: "dallas mavericks",
  nuggets: "denver nuggets",
  pistons: "detroit pistons",
  warriors: "golden state warriors",
  rockets: "houston rockets",
  pacers: "indiana pacers",
  clippers: "los angeles clippers",
  lakers: "los angeles lakers",
  grizzlies: "memphis grizzlies",
  heat: "miami heat",
  bucks: "milwaukee bucks",
  timberwolves: "minnesota timberwolves",
  wolves: "minnesota timberwolves",
  pelicans: "new orleans pelicans",
  knicks: "new york knicks",
  thunder: "oklahoma city thunder",
  magic: "orlando magic",
  "76ers": "philadelphia 76ers",
  sixers: "philadelphia 76ers",
  suns: "phoenix suns",
  "trail blazers": "portland trail blazers",
  blazers: "portland trail blazers",
  // "kings" omitted — ambiguous (NBA Sacramento Kings vs NHL Los Angeles Kings)
  spurs: "san antonio spurs",
  raptors: "toronto raptors",
  jazz: "utah jazz",
  wizards: "washington wizards",
  // 3-letter codes (Probable uses these)
  atl: "atlanta hawks",
  bos: "boston celtics",
  bkn: "brooklyn nets",
  cha: "charlotte hornets",
  chi: "chicago bulls",
  cle: "cleveland cavaliers",
  dal: "dallas mavericks",
  den: "denver nuggets",
  det: "detroit pistons",
  gsw: "golden state warriors",
  hou: "houston rockets",
  ind: "indiana pacers",
  lac: "los angeles clippers",
  lal: "los angeles lakers",
  mem: "memphis grizzlies",
  mia: "miami heat",
  mil: "milwaukee bucks",
  min: "minnesota timberwolves",
  nop: "new orleans pelicans",
  nyk: "new york knicks",
  okc: "oklahoma city thunder",
  orl: "orlando magic",
  phi: "philadelphia 76ers",
  phx: "phoenix suns",
  por: "portland trail blazers",
  sac: "sacramento kings",
  sas: "san antonio spurs",
  tor: "toronto raptors",
  uta: "utah jazz",
  was: "washington wizards",

  // ---------------------------------------------------------------------------
  // NHL teams (32 teams — full names, nicknames)
  // ---------------------------------------------------------------------------
  "anaheim ducks": "anaheim ducks",
  "arizona coyotes": "arizona coyotes",
  "boston bruins": "boston bruins",
  "buffalo sabres": "buffalo sabres",
  "calgary flames": "calgary flames",
  "carolina hurricanes": "carolina hurricanes",
  "chicago blackhawks": "chicago blackhawks",
  "colorado avalanche": "colorado avalanche",
  "columbus blue jackets": "columbus blue jackets",
  "dallas stars": "dallas stars",
  "detroit red wings": "detroit red wings",
  "edmonton oilers": "edmonton oilers",
  "florida panthers": "florida panthers",
  "los angeles kings": "los angeles kings",
  "minnesota wild": "minnesota wild",
  "montreal canadiens": "montreal canadiens",
  "nashville predators": "nashville predators",
  "new jersey devils": "new jersey devils",
  "new york islanders": "new york islanders",
  "new york rangers": "new york rangers",
  "ottawa senators": "ottawa senators",
  "philadelphia flyers": "philadelphia flyers",
  "pittsburgh penguins": "pittsburgh penguins",
  "san jose sharks": "san jose sharks",
  "seattle kraken": "seattle kraken",
  "st louis blues": "st louis blues",
  "tampa bay lightning": "tampa bay lightning",
  "toronto maple leafs": "toronto maple leafs",
  "utah hockey club": "utah hockey club",
  "vancouver canucks": "vancouver canucks",
  "vegas golden knights": "vegas golden knights",
  "washington capitals": "washington capitals",
  "winnipeg jets": "winnipeg jets",
  // NHL nicknames
  ducks: "anaheim ducks",
  coyotes: "arizona coyotes",
  bruins: "boston bruins",
  sabres: "buffalo sabres",
  flames: "calgary flames",
  hurricanes: "carolina hurricanes",
  blackhawks: "chicago blackhawks",
  avalanche: "colorado avalanche",
  "blue jackets": "columbus blue jackets",
  // "stars" omitted — ambiguous (NHL Dallas Stars vs other sports contexts)
  "red wings": "detroit red wings",
  oilers: "edmonton oilers",
  // "panthers" omitted — ambiguous (NHL Florida Panthers vs NFL Carolina Panthers)
  wild: "minnesota wild",
  canadiens: "montreal canadiens",
  habs: "montreal canadiens",
  predators: "nashville predators",
  preds: "nashville predators",
  devils: "new jersey devils",
  islanders: "new york islanders",
  // "rangers" omitted — ambiguous (NHL New York Rangers vs MLB Texas Rangers)
  senators: "ottawa senators",
  sens: "ottawa senators",
  flyers: "philadelphia flyers",
  penguins: "pittsburgh penguins",
  pens: "pittsburgh penguins",
  sharks: "san jose sharks",
  kraken: "seattle kraken",
  blues: "st louis blues",
  lightning: "tampa bay lightning",
  "maple leafs": "toronto maple leafs",
  canucks: "vancouver canucks",
  "golden knights": "vegas golden knights",
  capitals: "washington capitals",
  caps: "washington capitals",
  // "jets" omitted — ambiguous (NHL Winnipeg Jets vs NFL New York Jets)

  // ---------------------------------------------------------------------------
  // NFL teams (32 teams — full names, nicknames)
  // ---------------------------------------------------------------------------
  "arizona cardinals": "arizona cardinals",
  "atlanta falcons": "atlanta falcons",
  "baltimore ravens": "baltimore ravens",
  "buffalo bills": "buffalo bills",
  "carolina panthers": "carolina panthers",
  "chicago bears": "chicago bears",
  "cincinnati bengals": "cincinnati bengals",
  "cleveland browns": "cleveland browns",
  "dallas cowboys": "dallas cowboys",
  "denver broncos": "denver broncos",
  "detroit lions": "detroit lions",
  "green bay packers": "green bay packers",
  "houston texans": "houston texans",
  "indianapolis colts": "indianapolis colts",
  "jacksonville jaguars": "jacksonville jaguars",
  "kansas city chiefs": "kansas city chiefs",
  "las vegas raiders": "las vegas raiders",
  "los angeles chargers": "los angeles chargers",
  "los angeles rams": "los angeles rams",
  "miami dolphins": "miami dolphins",
  "minnesota vikings": "minnesota vikings",
  "new england patriots": "new england patriots",
  "new orleans saints": "new orleans saints",
  "new york giants": "new york giants",
  "new york jets": "new york jets",
  "philadelphia eagles": "philadelphia eagles",
  "pittsburgh steelers": "pittsburgh steelers",
  "san francisco 49ers": "san francisco 49ers",
  "seattle seahawks": "seattle seahawks",
  "tampa bay buccaneers": "tampa bay buccaneers",
  "tennessee titans": "tennessee titans",
  "washington commanders": "washington commanders",
  // NFL nicknames
  // "cardinals" omitted — ambiguous (NFL Arizona Cardinals vs MLB St Louis Cardinals)
  // "falcons" omitted — ambiguous (NFL Atlanta Falcons vs esports Team Falcons)
  ravens: "baltimore ravens",
  bills: "buffalo bills",
  bears: "chicago bears",
  bengals: "cincinnati bengals",
  browns: "cleveland browns",
  cowboys: "dallas cowboys",
  broncos: "denver broncos",
  lions: "detroit lions",
  packers: "green bay packers",
  texans: "houston texans",
  colts: "indianapolis colts",
  jaguars: "jacksonville jaguars",
  jags: "jacksonville jaguars",
  chiefs: "kansas city chiefs",
  raiders: "las vegas raiders",
  chargers: "los angeles chargers",
  rams: "los angeles rams",
  dolphins: "miami dolphins",
  vikings: "minnesota vikings",
  patriots: "new england patriots",
  pats: "new england patriots",
  saints: "new orleans saints",
  // "giants" omitted — ambiguous (NFL New York Giants vs MLB San Francisco Giants)
  eagles: "philadelphia eagles",
  steelers: "pittsburgh steelers",
  "49ers": "san francisco 49ers",
  niners: "san francisco 49ers",
  seahawks: "seattle seahawks",
  buccaneers: "tampa bay buccaneers",
  bucs: "tampa bay buccaneers",
  titans: "tennessee titans",
  commanders: "washington commanders",

  // ---------------------------------------------------------------------------
  // MLB teams (30 teams — full names, nicknames)
  // ---------------------------------------------------------------------------
  "arizona diamondbacks": "arizona diamondbacks",
  "atlanta braves": "atlanta braves",
  "baltimore orioles": "baltimore orioles",
  "boston red sox": "boston red sox",
  "chicago cubs": "chicago cubs",
  "chicago white sox": "chicago white sox",
  "cincinnati reds": "cincinnati reds",
  "cleveland guardians": "cleveland guardians",
  "colorado rockies": "colorado rockies",
  "detroit tigers": "detroit tigers",
  "houston astros": "houston astros",
  "kansas city royals": "kansas city royals",
  "los angeles angels": "los angeles angels",
  "los angeles dodgers": "los angeles dodgers",
  "miami marlins": "miami marlins",
  "milwaukee brewers": "milwaukee brewers",
  "minnesota twins": "minnesota twins",
  "new york mets": "new york mets",
  "new york yankees": "new york yankees",
  "oakland athletics": "oakland athletics",
  "philadelphia phillies": "philadelphia phillies",
  "pittsburgh pirates": "pittsburgh pirates",
  "san diego padres": "san diego padres",
  "san francisco giants": "san francisco giants",
  "seattle mariners": "seattle mariners",
  "st louis cardinals": "st louis cardinals",
  "tampa bay rays": "tampa bay rays",
  "texas rangers": "texas rangers",
  "toronto blue jays": "toronto blue jays",
  "washington nationals": "washington nationals",
  // MLB nicknames
  diamondbacks: "arizona diamondbacks",
  dbacks: "arizona diamondbacks",
  braves: "atlanta braves",
  orioles: "baltimore orioles",
  "red sox": "boston red sox",
  cubs: "chicago cubs",
  "white sox": "chicago white sox",
  reds: "cincinnati reds",
  guardians: "cleveland guardians",
  rockies: "colorado rockies",
  tigers: "detroit tigers",
  astros: "houston astros",
  royals: "kansas city royals",
  angels: "los angeles angels",
  dodgers: "los angeles dodgers",
  marlins: "miami marlins",
  brewers: "milwaukee brewers",
  twins: "minnesota twins",
  mets: "new york mets",
  yankees: "new york yankees",
  athletics: "oakland athletics",
  phillies: "philadelphia phillies",
  pirates: "pittsburgh pirates",
  padres: "san diego padres",
  mariners: "seattle mariners",
  rays: "tampa bay rays",
  "blue jays": "toronto blue jays",
  nationals: "washington nationals",
  nats: "washington nationals",

  // ---------------------------------------------------------------------------
  // Soccer — UCL / EPL naming variants
  // ---------------------------------------------------------------------------
  "man city": "manchester city",
  "manchester city": "manchester city",
  "man utd": "manchester united",
  "man united": "manchester united",
  "manchester united": "manchester united",
  psg: "paris saint-germain",
  "paris saint-germain": "paris saint-germain",
  "paris saint germain": "paris saint-germain",
  "spurs fc": "tottenham hotspur",
  "tottenham hotspur": "tottenham hotspur",
  tottenham: "tottenham hotspur",
};

/**
 * Replace known entity aliases with their canonical form in a normalized string.
 * Handles both single-word and multi-word aliases (e.g., "trail blazers" → "portland trail blazers").
 */
export function applyEntityAliases(s: string): string {
  // First pass: multi-word aliases (longest first to avoid partial matches)
  if (!_multiWordAliasRegex) {
    const multiWordKeys = Object.keys(ENTITY_ALIASES).filter((k) => k.includes(" "));
    if (multiWordKeys.length > 0) {
      // Sort longest first
      multiWordKeys.sort((a, b) => b.length - a.length);
      const pattern = multiWordKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      _multiWordAliasRegex = new RegExp(`\\b(${pattern})\\b`, "g");
    }
  }
  if (_multiWordAliasRegex) {
    s = s.replace(_multiWordAliasRegex, (match) => ENTITY_ALIASES[match] ?? match);
  }

  // Second pass: single-word aliases (skip if expansion already present in string)
  const words = s.split(/\s+/);
  return words.map((w) => {
    const alias = ENTITY_ALIASES[w];
    if (!alias || alias === w) return w;
    // Don't expand if the full alias value already appears in the string
    // (prevents "sacramento kings" → "sacramento sacramento kings")
    if (alias.includes(" ") && s.includes(alias)) return w;
    return alias;
  }).join(" ");
}

let _multiWordAliasRegex: RegExp | null = null;

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

  // Apply entity aliases (ETH → ethereum, BTC → bitcoin, etc.)
  s = applyEntityAliases(s);

  return s;
}

/**
 * Normalize an entity name extracted from a template.
 * Applies confusable replacement + lowercase + trim + strip trailing punct.
 */
export function normalizeEntity(s: string): string {
  let result = replaceConfusables(s)
    .toLowerCase()
    .trim()
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/[?.,!]+$/, "")
    // Strip parenthetical ticker suffixes: "Tesla (TSLA)" → "Tesla", "Silver (SI)" → "Silver"
    .replace(/\s*\([^)]+\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Apply entity alias mapping
  result = applyEntityAliases(result);
  return result;
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
  // Apply entity aliases (team names, tickers, etc.)
  result = applyEntityAliases(result);
  return result;
}
