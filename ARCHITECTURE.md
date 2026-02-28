# Architecture

Prophet is a prediction market arbitrage agent that trades across three BNB Chain CLOBs — Predict.fun, Probable, and Opinion Labs. It discovers cross-platform market matches, monitors live orderbooks for price dislocations, and executes hedged positions (buy YES on platform A + NO on platform B) to capture risk-free spreads.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Monorepo Structure](#monorepo-structure)
3. [Scanner Service](#scanner-service)
4. [Discovery Pipeline](#discovery-pipeline)
5. [Matching Engine](#matching-engine)
6. [Providers (Quote Fetching)](#providers)
7. [Arbitrage Detection](#arbitrage-detection)
8. [Execution Layer](#execution-layer)
9. [CLOB Clients](#clob-clients)
10. [Order Signing (EIP-712)](#order-signing)
11. [Adapter Strategy (On-Chain)](#adapter-strategy)
12. [Liquidity Checks](#liquidity-checks)
13. [Risk Management](#risk-management)
14. [Yield Rotation](#yield-rotation)
15. [Platform API](#platform-api)
16. [Wallet Infrastructure](#wallet-infrastructure)
17. [Frontend](#frontend)
18. [Database Schema](#database-schema)
19. [On-Chain Addresses](#on-chain-addresses)

---

## System Overview

```
                        ┌──────────────┐
                        │   Frontend   │  Next.js :3000
                        │  (Dashboard) │  Privy auth, React Query
                        └──────┬───────┘
                               │ REST (Privy bearer token)
                               │
                        ┌──────▼───────┐
                        │   Platform   │  Hono :4000
                        │     API      │  User mgmt, wallet custody, agent lifecycle
                        └──┬───────┬───┘
                           │       │
              ┌────────────▼─┐   ┌─▼──────────────┐
              │   Scanner    │   │  Agent Manager  │
              │   Service    │   │  (per-user)     │
              └──────┬───────┘   └────────┬────────┘
                     │                    │
              ┌──────▼───────┐   ┌────────▼────────┐
              │  Quote Store │   │ Agent Instance   │
              │  (in-memory) │──►│  scan() loop     │
              └──────────────┘   │  every 5s        │
                                 └────────┬────────┘
                                          │
                    ┌─────────────────────┬┴──────────────────────┐
                    │                     │                       │
             ┌──────▼──────┐    ┌────────▼────────┐    ┌────────▼────────┐
             │  Arbitrage   │    │    Executor     │    │  Yield Rotator  │
             │  Detector    │    │  (Vault/CLOB)   │    │  (optional)     │
             └──────────────┘    └───┬────┬────┬───┘    └─────────────────┘
                                     │    │    │
                              ┌──────▼┐ ┌─▼──┐ ┌▼───────┐
                              │Predict│ │Prob│ │Opinion │  CLOB Clients
                              │Client │ │able│ │Client  │  (EIP-712 orders)
                              └───────┘ └────┘ └────────┘
                                     │    │    │
                              ───────────────────────────  BNB Chain
                              Gnosis CTF  │  CLOB Exchanges  │  Safe Proxy
```

**Core loop**: Scanner fetches quotes every 5s from all three platforms. When a user starts their agent, the `AgentInstance` consumes those quotes, runs arbitrage detection, and executes hedged positions via CLOB limit/market orders. Trades are persisted to PostgreSQL and surfaced through the frontend dashboard.

---

## Monorepo Structure

```
prophit/
├── packages/
│   ├── agent/          # Trading engine (Node.js)
│   │   ├── src/
│   │   │   ├── api/server.ts              # Agent HTTP API (Hono, :3001)
│   │   │   ├── arbitrage/detector.ts      # Spread detection algorithm
│   │   │   ├── clob/                      # CLOB client implementations
│   │   │   │   ├── predict-client.ts      # Predict.fun (EOA, JWT)
│   │   │   │   ├── probable-client.ts     # Probable (Safe proxy, HMAC)
│   │   │   │   ├── opinion-client.ts      # Opinion Labs (EOA, API key)
│   │   │   │   ├── signing.ts            # EIP-712 order construction
│   │   │   │   └── types.ts             # Order types, ClobClient interface
│   │   │   ├── discovery/pipeline.ts     # Auto-discovery & cross-platform matching
│   │   │   ├── execution/
│   │   │   │   ├── executor.ts           # Execution orchestrator (vault + CLOB)
│   │   │   │   └── vault-client.ts       # Vault contract interaction
│   │   │   ├── matching-engine/
│   │   │   │   ├── index.ts             # 3-pass matching algorithm
│   │   │   │   └── normalizer.ts        # Unicode/title normalization
│   │   │   ├── providers/
│   │   │   │   ├── predict-provider.ts   # Predict orderbook fetcher
│   │   │   │   ├── probable-provider.ts  # Probable orderbook fetcher
│   │   │   │   ├── opinion-provider.ts   # Opinion orderbook fetcher
│   │   │   │   └── base.ts             # MarketProvider abstract class
│   │   │   ├── yield/
│   │   │   │   ├── scorer.ts            # Position scoring (risk-adjusted APY)
│   │   │   │   ├── allocator.ts         # Half-Kelly capital allocation
│   │   │   │   └── rotator.ts           # Position rotation suggestions
│   │   │   ├── agent-instance.ts        # Main orchestrator (scan loop)
│   │   │   ├── config.ts               # Env-based configuration
│   │   │   ├── persistence.ts           # State persistence (JSON file)
│   │   │   ├── retry.ts                # Exponential backoff helper
│   │   │   ├── types.ts                # Core types (MarketQuote, ArbitOpportunity, etc.)
│   │   │   └── utils.ts               # Shared utilities
│   │   └── vitest.config.ts
│   │
│   ├── platform/       # API server + services
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── server.ts            # Hono app + middleware stack
│   │   │   │   ├── middleware/rate-limit.ts
│   │   │   │   └── routes/
│   │   │   │       ├── auth.ts          # Privy token verification
│   │   │   │       ├── wallet.ts        # Deposit/withdraw endpoints
│   │   │   │       ├── agent.ts         # Agent start/stop/status
│   │   │   │       ├── markets.ts       # Public opportunity browser
│   │   │   │       ├── trades.ts        # Trade history
│   │   │   │       └── config.ts        # User trading config
│   │   │   ├── scanner/
│   │   │   │   ├── service.ts           # Quote fetching loop
│   │   │   │   └── quote-store.ts       # In-memory quote cache
│   │   │   ├── agents/
│   │   │   │   └── agent-manager.ts     # Per-user agent lifecycle
│   │   │   ├── wallets/
│   │   │   │   ├── privy-wallet.ts      # Privy embedded wallet
│   │   │   │   ├── privy-account.ts     # Viem account adapter for Privy signing
│   │   │   │   ├── safe-deployer.ts     # Gnosis Safe proxy deployment
│   │   │   │   ├── deposit-watcher.ts   # On-chain deposit polling
│   │   │   │   └── withdrawal.ts        # Withdrawal processor
│   │   │   └── auth/
│   │   │       ├── privy.ts            # Privy client setup
│   │   │       └── middleware.ts        # Auth middleware
│   │   └── package.json
│   │
│   ├── frontend/       # Next.js dashboard
│   │   ├── src/
│   │   │   ├── app/                     # App router pages
│   │   │   ├── components/              # UI components
│   │   │   ├── hooks/                   # React Query + auth hooks
│   │   │   └── lib/                     # Formatting utilities
│   │   └── package.json
│   │
│   └── shared/         # Shared types & DB schema
│       ├── src/
│       │   ├── db/schema.ts            # Drizzle ORM tables
│       │   └── types.ts                # Shared TypeScript interfaces
│       └── package.json
│
├── docker-compose.yml   # PostgreSQL, Anvil, all services
└── pnpm-workspace.yaml
```

---

## Scanner Service

The scanner runs inside the platform process and continuously fetches live orderbook data from all three CLOBs.

**File**: `packages/platform/src/scanner/service.ts`

### Initialization

1. **Auto-discovery**: Calls `runDiscovery()` from the agent package to find cross-platform market matches. This produces market maps (shared key -> platform-specific metadata) and title/link maps for the frontend.
2. **Provider instantiation**: Creates `PredictProvider`, `ProbableProvider`, and `OpinionProvider` instances, each initialized with their respective market maps from discovery.

### Scan Loop

```
start()
  └─► scan() [every scanIntervalMs, default 5000ms]
        ├─► Promise.allSettled(providers.map(p => p.fetchQuotes()))
        ├─► Collect successful results into allQuotes[]
        ├─► Log failed providers (non-fatal, continues with partial data)
        ├─► Extract metaResolvers from providers
        └─► quoteStore.update(allQuotes, metaResolvers)
```

Individual provider failures don't halt the scanner — if Probable is down, Predict and Opinion quotes still flow. Each provider has internal retry logic with exponential backoff.

### Quote Store

**File**: `packages/platform/src/scanner/quote-store.ts`

In-memory cache holding the latest `MarketQuote[]` plus metadata:

- **Quotes**: Replaced wholesale on each scan cycle (not merged)
- **Titles**: `Map<marketId, string>` — populated during auto-discovery
- **Links**: `Map<marketId, { predict?, probable?, opinion? }>` — platform URLs
- **Meta resolvers**: `Map<providerName, provider>` — used by the executor to resolve token IDs at execution time

The quote store is shared between the scanner (writer) and per-user agent instances (readers).

---

## Discovery Pipeline

**File**: `packages/agent/src/discovery/pipeline.ts`

Discovery runs once at platform startup (or on-demand via API) to identify which markets on different platforms represent the same underlying event.

### Stage 1: Fetch Markets (Parallel)

Three parallel fetches, each paginated:

| Platform | Endpoint | Filter | Output |
|----------|----------|--------|--------|
| Probable | `GET /public/api/v1/events?active=true` | Active events | Markets with conditionId, clobTokenIds, slug |
| Predict | `GET /v1/markets?status=OPEN` + `/v1/categories` | Open markets | Markets with conditionId, tokenIds, category |
| Opinion | `GET /market?pageSize=10` | status="Activated" | Markets with topicId, tokenIds |

Each yields `DiscoveredMarket`:
```typescript
{
  platform: string;
  id: string;
  title: string;
  conditionId?: string;
  yesTokenId: string;
  noTokenId: string;
  category?: string;
  resolvesAt?: string;
  slug?: string;        // Probable only
  topicId?: number;     // Opinion only
}
```

### Stage 2: Match Platform Pairs

Three pair-wise matching passes via the matching engine:
- Probable <-> Predict
- Opinion <-> Predict
- Opinion <-> Probable

### Output

```typescript
interface DiscoveryResult {
  discoveredAt: string;              // ISO timestamp
  probableMarkets: number;
  predictMarkets: number;
  matches: MarketMatch[];            // Cross-platform matches
  probableMarketMap: Record<key, { conditionId, yesTokenId, noTokenId, slug }>;
  predictMarketMap:  Record<key, { conditionId, yesTokenId, noTokenId, predictMarketId }>;
  opinionMarketMap:  Record<key, { yesTokenId, noTokenId }>;
  titleMap: Record<key, string>;     // Shared key -> canonical title
  linkMap:  Record<key, URLs>;       // Shared key -> platform URLs
}
```

Map keys are Predict-anchored conditionIds (backward compat). When Predict isn't part of a match (e.g., Opinion<->Probable), the key falls back to Probable's conditionId or a composite key.

---

## Matching Engine

**Files**: `packages/agent/src/matching-engine/index.ts`, `normalizer.ts`

Deterministic 3-pass algorithm that matches markets across platforms without LLM assistance. Designed for zero false positives at the cost of some false negatives.

### Normalization Pipeline

Before matching, all market titles pass through normalization:

**`normalizeTitle(title)`**:
1. Replace Unicode confusables (Cyrillic, Greek lookalikes) with ASCII equivalents
2. NFKD decomposition + strip combining marks (e.g., "cafe" from "cafe")
3. Collapse digit separators (`100,000` -> `100000`)
4. Lowercase
5. Strip non-word/non-space characters
6. Remove standalone current year tokens (e.g., "2026")
7. Collapse whitespace + trim

**`normalizeEntity(entity)`**: Confusable replacement, lowercase, strip leading articles (`the/a/an`), strip trailing punctuation.

**`normalizeParams(params)`**: Lowercase, strip `$/?`, remove current year, strip trailing punctuation.

### Similarity Functions

**Jaccard (word-level)**: `|intersection| / |union|` of word sets (stop words removed). Good for word reordering.

**Dice (bigram-level)**: `2 * |intersection| / (|bigrams_a| + |bigrams_b|)` over character bigrams. Good for substring shifts.

**Composite**: `max(jaccard, dice)` — takes whichever metric scores higher.

### 3-Pass Algorithm

```
matchMarkets(listA, listB) -> MatchResult[]

Pass 1: Exact conditionId
  For each pair where both have conditionId:
    if conditionId_A == conditionId_B -> match (score 1.0)

Pass 2: Template + Entity/Params
  Extract templates from titles (e.g., "token-launch: {entity} by {date}")
  For each pair with matching template name:
    if normalizeEntity(a) == normalizeEntity(b) AND
       normalizeParams(a) == normalizeParams(b) -> match (score 0.99)

Pass 3: Composite Similarity
  For each remaining unmatched pair:
    score = compositeSimilarity(normalizedTitle_A, normalizedTitle_B)
    if score >= 0.85:
      Template guard: if both matched same template in Pass 2 extraction
        but failed Pass 2 (different entity/params) -> skip
        (prevents false positives like "Basel" vs "Based")
      else -> match
```

### Template Patterns

| Template | Pattern | Entity | Params |
|----------|---------|--------|--------|
| `fdv-above` | "FDV above $XXX" | project name | price target |
| `token-launch` | "launch a token by DATE" | project name | date |
| `price-target` | "hit/reach PRICE" | asset name | price |
| `win-comp` | "win COMPETITION" | team name | competition |
| `ipo-by` | "IPO by DATE" | company name | date |

The template guard is critical: without it, Dice similarity would false-positive on pairs like "Basel launch token" vs "Based launch token" (0.85+ bigram similarity, completely different markets).

### Production Performance

~455 Probable markets, ~2098 Predict markets, ~87 Opinion markets:
- 102 total matches found (92 Probable<->Predict, 2 Opinion<->Predict, 8 Opinion<->Probable)
- ~10s runtime for O(n^2) Pass 3 (~1M pairs)
- 0 false positives, 0 validation drops

---

## Providers

**Base**: `packages/agent/src/providers/base.ts`

```typescript
abstract class MarketProvider {
  readonly name: string;
  readonly adapterAddress: `0x${string}`;
  abstract fetchQuotes(): Promise<MarketQuote[]>;
}
```

All providers normalize to:
```typescript
interface MarketQuote {
  marketId: `0x${string}`;
  protocol: string;          // "Predict" | "Probable" | "Opinion"
  yesPrice: bigint;          // 18 decimals (1e18 = $1.00)
  noPrice: bigint;           // 18 decimals
  yesLiquidity: bigint;      // 6 decimals (USDT)
  noLiquidity: bigint;       // 6 decimals (USDT)
  feeBps: number;            // Protocol fee in basis points
  quotedAt: number;          // Date.now() timestamp
}
```

### Predict Provider

**API**: `GET /v1/markets/{predictMarketId}/orderbook` (authenticated with x-api-key)

Predict uses a **unified orderbook** — there's one book for YES tokens, with asks (sellers) and bids (buyers):
- **YES price** = lowest ask (best price to buy YES)
- **NO price** = `1.0 - highest bid` (complement of best YES bid)

This complement approach can create phantom spreads when the YES bid-ask spread is wide.

**Liquidity**: Sum of ask quantities within 200 bps of best ask, converted to 6-decimal USDT.

**Concurrency**: `pMap` with concurrency=10, `withRetry(retries=1, delay=500ms)` per market.

**Fee**: 200 bps (2%) hardcoded.

### Probable Provider

**API**: `GET /public/api/v1/book?token_id={tokenId}` (public, no auth)

Probable has **separate orderbooks** for YES and NO tokens — no complement calculation needed:
- **YES price** = lowest ask on YES orderbook
- **NO price** = lowest ask on NO orderbook

**Liquidity**: Sum within 100 bps of best ask (stricter than Predict).

**Dead market tracking**: Markets returning 400 errors are added to a `deadMarketIds` set and skipped on future polls.

**Concurrency**: `pMap` concurrency=10, `withRetry(retries=1, delay=500ms, skip 400s)`.

**Fee**: 175 bps (1.75%).

### Opinion Provider

**API**: `GET /token/orderbook?token_id={tokenId}` (authenticated with API key)

Identical approach to Probable — separate YES/NO orderbooks, 100 bps liquidity band.

**Response format**: Wrapped in `{ errno: 0, result: { asks, bids } }`.

**Concurrency**: `pMap` concurrency=5 (stricter rate limits), `withRetry(retries=1, delay=500ms)`.

**Fee**: 200 bps (2%) fixed.

### Quote Format Summary

| Aspect | Predict | Probable | Opinion |
|--------|---------|----------|---------|
| Orderbook | Unified (YES only) | Separate YES + NO | Separate YES + NO |
| NO price derivation | 1.0 - best YES bid | Direct (NO best ask) | Direct (NO best ask) |
| Liquidity band | 200 bps | 100 bps | 100 bps |
| Fee | 200 bps | 175 bps | 200 bps |
| Auth | x-api-key | None (public) | API key |
| Concurrency | 10 | 10 | 5 |

---

## Arbitrage Detection

**File**: `packages/agent/src/arbitrage/detector.ts`

**Function**: `detectArbitrage(quotes: MarketQuote[]) -> ArbitOpportunity[]`

### Algorithm

1. **Group quotes by marketId** — need >= 2 quotes per market (from different platforms) to find an arb.

2. **For each market, check all protocol pairs** (i, j where i < j):

   **Strategy 1**: Buy YES on A + NO on B
   ```
   totalCost = yesPrice_A + noPrice_B     (both 1e18)
   grossSpread = 1e18 - totalCost         (positive if cost < $1)
   ```

   **Strategy 2**: Buy NO on A + YES on B (symmetric check)

3. **Fee calculation** — worst-case analysis:
   ```
   If YES wins: fee = (1e18 - yesPrice_A) * feeBps_A / 10000
   If NO wins:  fee = (1e18 - noPrice_B)  * feeBps_B / 10000
   worstCaseFee = max(fee_if_YES_wins, fee_if_NO_wins)
   ```
   The fee is charged on the winning leg's profit, not the total position.

4. **Net spread**: `effectivePayout - totalCost` where `effectivePayout = 1e18 - worstCaseFee`

5. **Filter**: Only emit if `netSpread > 0`

6. **Output**:
   ```typescript
   {
     marketId, protocolA, protocolB,
     buyYesOnA: boolean,                  // true = buy YES on A, NO on B
     yesPriceA, noPriceB, totalCost,
     guaranteedPayout: 1e18,              // one outcome always resolves YES
     spreadBps: (netSpread * 10000) / 1e18,
     grossSpreadBps: (grossSpread * 10000) / 1e18,
     feesDeducted: worstCaseFee,
     estProfit: (100 USDT * netSpread) / 1e18,   // reference: $100 trade
     liquidityA, liquidityB,
     quotedAt: min(quoteA.quotedAt, quoteB.quotedAt)
   }
   ```

7. **Sort by spreadBps descending** — best opportunities first.

### Agent Filtering

`AgentInstance.scan()` applies additional filters before execution:
- `minSpreadBps <= spreadBps <= maxSpreadBps` (configurable per user, defaults 50-400)
- Dedup window: skip markets traded in the last 5 minutes
- Daily loss limit check: halt if cumulative loss exceeds threshold

---

## Execution Layer

**File**: `packages/agent/src/execution/executor.ts`

Two execution modes, selected via `EXECUTION_MODE` env var:

### Vault Mode

Uses the `ProphitVault` smart contract for atomic on-chain execution. Both legs are settled via adapter contracts in a single transaction.

```
Executor.executeVault(opportunity, maxPositionSize)
  ├─► Split maxPositionSize / 2 for each leg
  ├─► Cap to 90% of available liquidity (slippage buffer)
  ├─► Check vault USDT balance is sufficient
  ├─► Estimate gas (~400k gas * gasPrice * gasToUsdtRate)
  ├─► Reject if gas cost exceeds estimated profit
  ├─► Calculate minShares with 95% slippage protection
  └─► vaultClient.openPosition(adapterA, adapterB, marketIdA, marketIdB, ...)
```

### CLOB Mode (Primary)

Sequential order placement across separate CLOB exchanges. This is the main production mode.

```
Executor.executeClob(opportunity, maxPositionSize)
  │
  ├─► PRE-CHECKS
  │   ├─► Market cooldown check (30 min after Probable FOK failures)
  │   ├─► Quote staleness check (reject if > 15s old)
  │   ├─► Resolve token IDs via provider metadata
  │   ├─► Calculate position size (see Liquidity Checks)
  │   └─► Pre-check USDT balance (EOA for Predict, Safe for Probable)
  │
  ├─► LEG 1: UNRELIABLE LEG (Probable or Opinion) — FOK
  │   ├─► Build PlaceOrderParams (tokenId, side=BUY, price, size)
  │   ├─► Place FOK order via CLOB client
  │   ├─► Wait 3s
  │   ├─► Verify fill via balance delta (Safe balance if Probable, EOA if Opinion)
  │   ├─► Fallback: check API filledQty
  │   └─► If not filled: set 30-min market cooldown, abort (cost $0)
  │
  ├─► LEG 2: RELIABLE LEG (Predict) — FOK
  │   ├─► Place FOK order via Predict client
  │   ├─► Wait 3s
  │   ├─► Verify fill via EOA balance delta
  │   └─► If failed after Leg 1 filled: PARTIAL status (naked exposure!)
  │       ├─► Pause executor
  │       └─► Attempt unwind of Leg 1 (see below)
  │
  └─► Return ClobPosition with status + leg details
```

**Why sequential?** Probable/Opinion have thinner orderbooks and less reliable FOK execution. By placing the unreliable leg first, we either succeed (and then lock in the reliable Predict leg) or fail cheaply (no capital at risk). If we placed Predict first, a Probable failure would leave us with naked directional exposure.

### Unwind Logic

When the second leg fails after the first fills (PARTIAL status), the executor attempts to unwind:

```
attemptUnwind(filledLeg)
  for discount in [5%, 10%, 20%]:
    price = leg.price * (1 - discount)
    Place SELL LIMIT GTC order at discounted price
    Poll for up to 5 minutes
    if filled: auto-unpause executor, done
    if on-book but not filling: try deeper discount
    if immediately rejected: try deeper discount

  if all discounts fail: stay paused, require manual intervention
```

**Transient vs systematic**: If the order was accepted and sat on the book (transient liquidity issue), the executor auto-unpauses. If all orders were immediately rejected (systematic issue), it stays paused.

---

## CLOB Clients

All three implement the `ClobClient` interface:

```typescript
interface ClobClient {
  readonly name: string;
  readonly exchangeAddress: `0x${string}`;
  authenticate(): Promise<void>;
  placeOrder(params: PlaceOrderParams): Promise<OrderResult>;
  cancelOrder(orderId: string, tokenId?: string): Promise<boolean>;
  getOpenOrders(): Promise<Order[]>;
  getOrderStatus(orderId: string): Promise<OrderStatusResult>;
  ensureApprovals(publicClient, fundingThreshold?): Promise<void>;
  getAvailableBalance?(tokenId: string): Promise<number>;
}
```

### Predict Client

**Auth**: JWT-based.
1. `GET /v1/auth/message` -> nonce
2. Sign message via `personal_sign`
3. `POST /v1/auth` -> JWT (cached, auto-refreshed on 401)

**Exchange resolution**: Predict has multiple exchange contracts per market type:
- Standard: `0x8BC070...`
- NegRisk: `0x365fb8...`
- YieldBearing: `0x6bEb5a...`
- YieldBearing + NegRisk: `0x8A289d...`

Resolved via `GET /v1/markets/{marketId}` and cached.

**Order placement**: `POST /v1/orders` with EIP-712 signed order + `pricePerShare` as wei string. Scale 1e18, slippage 200 bps for MARKET orders.

**Fill verification**: `GET /v1/orders/{orderId}`. 404 -> treated as CANCELLED (needs balance check to distinguish from silent fill).

**Approvals**: ERC-1155 `setApprovalForAll` + ERC-20 max approve to all 4 exchange contracts.

### Probable Client

**Auth**: Dual-layer.
- **L1 (per-request)**: EIP-712 `ClobAuthDomain` signature with timestamp/nonce. Sent as `Prob_address`, `Prob_signature`, `Prob_timestamp`, `Prob_nonce` headers.
- **L2 (persistent)**: HMAC-SHA256 API credentials obtained via `POST /auth/api-key`. HMAC signs `${timestamp}${method}${path}${body}`. Sent as `Prob_api_key`, `Prob_passphrase`, `Prob_signature` headers.

**Safe proxy support**: When `proxyAddress` is configured:
- `maker` = Safe address, `signer` = EOA address
- `signatureType` = 2 (POLY_GNOSIS_SAFE)
- Approvals executed via `Safe.execTransaction()` (EIP-712 SafeTx)
- Auto-funds Safe from EOA (reserves 50% + 5% for Predict leg)

**Order placement**: `POST /public/api/v1/order/{chainId}` with `deferExec: true`, `orderType: "IOC"` (fill-or-kill) or `"GTC"`.

**Quantization**: Orders are quantized to 0.01 qty step + 0.001 price tick to satisfy Probable's matching engine.

**Fill verification**: `GET /public/api/v1/order/{chainId}/{orderId}`. 404 -> treated as FILLED (FOK orders are removed immediately after fill/cancel).

**Approvals**: ERC-1155 to exchange + ERC-20 to exchange AND CTF contract (for splits/merges). Uses `execSafeTransaction` if proxy is configured.

### Opinion Client

**Auth**: Static API key on every request.

**Order placement**: `POST /order` with EIP-712 signed order + `tradingMethod: 1` (MARKET) or `2` (LIMIT), `topicId: marketId`.

**Response parsing**: `filled: "filledQty/totalQty"` string format.

**Approvals**: Direct EOA only (no Safe support). ERC-1155 + ERC-20 to exchange.

### Client Comparison

| Aspect | Predict | Probable | Opinion |
|--------|---------|----------|---------|
| Auth | JWT + personal_sign | EIP-712 L1 + HMAC L2 | API key |
| Domain name | "predict.fun CTF Exchange" | "Probable CTF Exchange" | "OPINION CTF Exchange" |
| Proxy wallet | No | Yes (Gnosis Safe) | No |
| Quantization | No (derives from price) | Yes (0.01 qty, 0.001 price) | Yes (0.01 qty, 0.001 price) |
| Slippage (MARKET) | 200 bps | 100 bps | 100 bps |
| Cancel | POST with orderId | DELETE with orderId + tokenId | POST with orderId |
| 404 semantics | CANCELLED | FILLED (FOK) | N/A |
| Min fee | 200 bps | 175 bps | 200 bps |
| Scale | 1e18 | 1e18 | 1e18 |

---

## Order Signing

**File**: `packages/agent/src/clob/signing.ts`

All three platforms use EIP-712 typed data signing with the same order structure (Polymarket-derived):

```typescript
interface ClobOrder {
  salt: bigint;           // Random per-order
  maker: address;         // Order placer (EOA or Safe)
  signer: address;        // Signature source (always EOA)
  taker: address;         // 0x0 (open order)
  tokenId: bigint;        // Outcome token ID
  makerAmount: bigint;    // What maker offers
  takerAmount: bigint;    // What maker expects
  expiration: bigint;     // Unix seconds
  nonce: bigint;          // Sequence number
  feeRateBps: bigint;     // Platform fee
  side: 0 | 1;           // 0=BUY, 1=SELL
  signatureType: 0|1|2;   // EOA / POLY_PROXY / POLY_GNOSIS_SAFE
}
```

### Amount Calculation (`buildOrder`)

**BUY**: `makerAmount = sizeUSDT`, `takerAmount = sizeUSDT / price` (shares received)
**SELL**: `makerAmount = shares`, `takerAmount = shares * price` (USDT received)

**Precision handling**: Two-step multiply to avoid IEEE 754 loss:
```typescript
sizeRaw = BigInt(Math.round(size * 1e8)) * scaleBig / 100_000_000n
```

**Quantization (Probable)**: Rounds shares to 0.01 step, re-snaps price to 0.001 tick after slippage application.

**Predict LIMIT precision**: For limit orders, derives the dependent amount from the independent to ensure `takerAmount == priceWei * makerAmount / 1e18` exactly, quantized to `1e10`-aligned boundaries.

### Slippage Application

- **BUY**: Inflates `makerAmount` (willing to pay more)
- **SELL**: Deflates `takerAmount` (willing to receive less)
- After slippage, re-snaps to price ticks for Probable

### Auth Signatures

**`signClobAuth()`**: EIP-712 signature for Probable/Opinion REST API headers. Message: "This message attests that I control the given wallet".

**`buildHmacSignature()`**: HMAC-SHA256 for Probable L2 order operations. Signs `${timestamp}${method}${path}${body}` with base64url-decoded secret.

---

## Adapter Strategy

**On-chain contracts (Vault mode only)**

The vault delegates market interaction to platform-specific adapter contracts implementing `IProtocolAdapter`:

```solidity
interface IProtocolAdapter {
    function getQuote(bytes32 marketId) -> MarketQuote;
    function buyOutcome(bytes32 marketId, bool buyYes, uint256 amount) -> uint256 shares;
    function sellOutcome(bytes32 marketId, bool sellYes, uint256 shares) -> uint256 payout;
    function redeem(bytes32 marketId) -> uint256 payout;
    function isResolved(bytes32 marketId) -> bool;
}
```

### Inventory System

Each adapter maintains an inventory to avoid redundant CTF splits:

```solidity
mapping(bytes32 => uint256) public yesInventory;
mapping(bytes32 => uint256) public noInventory;
```

When `buyOutcome(YES, 100 USDT)` is called:
1. Check if yesInventory has enough -> transfer from inventory
2. If not: call `CTF.splitPosition(100 USDT)` -> produces 100 YES + 100 NO
3. Transfer 100 YES to vault, store 100 NO in `noInventory`
4. Future `buyOutcome(NO)` calls can use the stored inventory

This avoids paying split gas twice when the vault is making complementary bets on the same market.

### ProphitVault Contract

**State**:
- `collateral`: IERC20 (USDT)
- `agent`: single authorized executor address
- `Position[]`: all positions ever opened

**Circuit breakers**:
- `dailyTradeLimit = 50` (max trades/day)
- `dailyLossLimit = 1000e6` (max cumulative loss/day, 6 decimals)
- `positionSizeCap = 500e6` (max collateral per leg)
- `cooldownSeconds = 10` (min time between trades)
- Daily counters reset at UTC midnight

**`openPosition` flow**:
1. Validate adapters are approved
2. Check all circuit breakers
3. Approve adapters to spend collateral
4. Call `adapterA.buyOutcome()` + `adapterB.buyOutcome()`
5. Reset approvals to 0 (prevent dangling allowance)
6. Verify minShares slippage
7. Store Position, update counters, emit event

**`closePosition` flow**:
1. Mark closed immediately (CEI pattern)
2. Record pre-balance
3. Call `adapter.redeem()` on both adapters
4. Compute payout from balance delta
5. Verify `payout >= minPayout`
6. Track loss if payout < cost

### CLOB-Mode Redemption

In CLOB mode, resolved positions are redeemed directly from the Gnosis CTF contracts:

```typescript
// For each filled leg, determine indexSet from tokenId
isYes = (tokenId == metadata.yesTokenId)
indexSets = [isYes ? 1 : 2]

// Call CTF redeemPositions
ctf.redeemPositions(USDT, parentCollectionId=0x0, conditionId, indexSets)
```

Resolution is detected by checking `ctf.payoutDenominator(conditionId) > 0` on each platform's CTF contract.

---

## Liquidity Checks

Liquidity validation happens at multiple stages:

### 1. Quote-Level (Provider)

Each provider filters out illiquid markets during quote fetching:

```
MIN_LIQUIDITY = 1_000_000 (1 USDT, 6 decimals)

if yesLiquidity < MIN_LIQUIDITY or noLiquidity < MIN_LIQUIDITY:
    skip market entirely
```

Liquidity is measured as the sum of ask quantities within a slippage band of the best ask:
- Predict: 200 bps band
- Probable/Opinion: 100 bps band

### 2. Opportunity-Level (Detector)

The `ArbitOpportunity` carries `liquidityA` and `liquidityB` fields (6 decimals USDT) representing available depth on each leg. These are used downstream for position sizing.

### 3. Execution-Level (Executor)

Position size is capped to available liquidity:

```typescript
// Start with user's max position size
let sizeUsdt = hasSeparateWallets ? maxPositionSize : maxPositionSize / 2

// Cap to 90% of available liquidity on each leg
sizeUsdt = Math.min(sizeUsdt, liquidityA * 0.9, liquidityB * 0.9)

// Enforce minimum trade size (default 2 USDT)
if (sizeUsdt < minTradeSize) return  // skip, not enough liquidity
```

The 90% cap prevents the order from consuming the entire book depth, which would cause slippage and potential partial fills.

### 4. Balance-Level (Pre-Execution)

Before placing orders, the executor verifies sufficient USDT balance:

```typescript
// EOA balance covers Predict + Opinion legs
eoaBalance = USDT.balanceOf(eoaAddress)

// Safe balance covers Probable leg (if proxy configured)
safeBalance = USDT.balanceOf(probableProxyAddress)
requiredWithBuffer = size * 1.02 * 1e6 * 1e12  // 2% buffer for fees

if (safeBalance < required):
    sizeUsdt = floor(safeBalance / 1.02)  // cap to available
```

### 5. Fill Verification (Post-Execution)

After each leg, actual fill is verified via on-chain balance delta:

```typescript
preBal = USDT.balanceOf(wallet)
// ... place order, wait 3s ...
postBal = USDT.balanceOf(wallet)
spent = preBal - postBal
filled = spent > legMinSpend  // 50% of expected spend threshold
```

This catches cases where the API reports success but the on-chain settlement didn't happen (e.g., front-run, stale quote).

---

## Risk Management

### Stale Quote Rejection

```typescript
MAX_QUOTE_AGE_MS = 15_000  // 15 seconds

quoteAge = Date.now() - opportunity.quotedAt
if (quoteAge > MAX_QUOTE_AGE_MS) reject("quotes too old")
```

Prevents executing on prices that have already moved.

### Market Cooldown

Markets are placed on a 30-minute cooldown after:
- Probable/Opinion FOK rejection
- Predict failure after first leg fill (PARTIAL)
- Balance verification failures

```typescript
marketCooldowns: Map<string, number>  // marketKey -> expiry timestamp
MARKET_COOLDOWN_MS = 30 * 60 * 1000

// Before execution:
if (Date.now() < cooldownExpiry) skip("market on cooldown")
```

Cooldowns are seeded from recent PARTIAL trades on agent restart (survives restarts).

### Dedup Window

5-minute window prevents re-executing the same market:

```typescript
recentTrades: Map<string, number>  // marketId -> executed timestamp
DEDUP_WINDOW_MS = 5 * 60 * 1000

if (Date.now() - lastTraded < DEDUP_WINDOW_MS) skip("recently traded")
```

### Daily Loss Limit

Tracked per-day (UTC midnight reset):

```typescript
startOfDayBalance = USDT.balanceOf(wallet)  // captured at UTC midnight
currentBalance = USDT.balanceOf(wallet)
dayLoss = startOfDayBalance - currentBalance

if (dayLoss >= dailyLossLimit) halt("daily loss limit reached")
```

Configurable per user (default $50 USDT). Stops the agent entirely until the next day.

### Executor Pause

On PARTIAL fills (one leg filled, other failed), the executor auto-pauses:
- No new trades are placed
- Unwind is attempted for the exposed leg
- Auto-unpause only on transient failures
- Systematic failures require manual intervention

### Vault Circuit Breakers (Vault Mode Only)

On-chain enforcement in the ProphitVault contract:
- `dailyTradeLimit`: 50 trades/day
- `dailyLossLimit`: 1000 USDT/day
- `positionSizeCap`: 500 USDT/leg
- `cooldownSeconds`: 10s between trades
- 24-hour timelock for agent replacement

---

## Yield Rotation

**Files**: `packages/agent/src/yield/scorer.ts`, `allocator.ts`, `rotator.ts`

Optional module (enabled via `yieldRotationEnabled` config) that scores existing positions and suggests capital reallocation.

### Position Scoring

Each open position is scored by risk-adjusted annualized return:

```
expectedReturn = (minShares_as_USDT - totalCost) / totalCost
timeToResolutionYears = estimatedResolution / MS_PER_YEAR
annualizedYield = expectedReturn / timeToResolutionYears

score = annualizedYield * liquidityFactor * (1 - oracleRiskDiscount)
```

**Risk factors**:
- `negative_expected_return`: payout <= cost (underwater)
- `near_resolution`: < 24h to estimated resolution
- `imbalanced_shares`: min/max share ratio < 0.8
- `cross_oracle`: different adapters for each leg (5% discount)

### Capital Allocation (Half-Kelly)

New opportunities are sized using the Kelly criterion at half-size (conservative):

```
b = (1e18 - totalCost) / totalCost     // odds ratio
p = 0.95                                // success probability (arb is near-certain)
q = 0.05                                // execution risk

kellyFraction = (p * b - q) / b
halfKelly = kellyFraction / 2

recommendedSize = halfKelly * availableCapital
```

Opportunities ranked by annualized yield, allocated in order until capital exhausted.

### Rotation Suggestions

Compares existing position yields against new opportunity yields:

```
for each scored position:
    for each new opportunity (sorted by yield desc):
        improvement = newYield - currentYield
        if improvement >= minImprovementBps (default 200 bps):
            exitCost = gasEstimate * 2  // close + reopen
            netImprovement = improvement - exitCostFraction
            if netImprovement > 0:
                suggest rotation
```

Only 1 suggestion per position (best available improvement).

---

## Platform API

**File**: `packages/platform/src/api/server.ts` — Hono on port 4000

### Middleware Stack

1. Request logger (method, path, status, duration)
2. CORS (restricted to `CORS_ORIGIN` in production)
3. Rate limiting:
   - Auth endpoints: 10 req/min per IP
   - General API: 60 req/min per IP
   - Withdrawals: 5 req/min per user
4. Auth middleware (Privy bearer token verification)

### Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/auth/me` | No | Verify Privy token, find-or-create user |
| GET | `/api/markets` | No | Public opportunity browser (runs `detectArbitrage` on quote store) |
| GET | `/api/wallet` | Yes | Wallet address, USDT/BNB balances, deposit history |
| POST | `/api/wallet/withdraw` | Yes | Request withdrawal (daily limit: 1000 USDT) |
| POST | `/api/agent/start` | Yes | Start user's trading agent |
| POST | `/api/agent/stop` | Yes | Stop user's trading agent |
| GET | `/api/agent/status` | Yes | Agent running state, trades, P&L |
| GET | `/api/trades` | Yes | Paginated trade history (max 100/page) |
| GET | `/api/trades/:id` | Yes | Single trade detail (ownership verified) |
| GET | `/api/me` | Yes | User profile + trading config |
| PATCH | `/api/me/config` | Yes | Update trading parameters |

### Agent Lifecycle (`POST /api/agent/start`)

1. Get/create user config from DB
2. Check for already running agent (409 if so)
3. Get Privy embedded wallet
4. Deploy/fetch Gnosis Safe proxy for Probable leg
5. Seed market cooldowns from recent PARTIAL trades
6. Via AgentManager:
   - Initialize 3 CLOB clients (Probable, Predict, Opinion)
   - Authenticate all clients (sequential: auth -> nonce -> approvals)
   - Create Executor with CLOB clients
   - Create AgentInstance with trade callback (persists to DB)
7. Start scan loop

---

## Wallet Infrastructure

### Privy Embedded Wallets

Users authenticate via Privy (email/social login). Privy creates and manages an embedded Ethereum wallet for each user — no MetaMask or external wallet needed.

**`privy-account.ts`**: Adapts Privy's signing API to a Viem `Account` interface, enabling standard `writeContract`/`signTypedData` calls to route through Privy's delegated signing infrastructure.

### Gnosis Safe Proxy (Probable)

Probable requires orders to come from a Safe proxy (for `signatureType: 2 = POLY_GNOSIS_SAFE`).

**`safe-deployer.ts`**:
1. Compute deterministic proxy address via factory (`0xB991...`)
2. Check if already deployed (bytecode check)
3. If not: sign EIP-712 `CreateProxy` typed data, call `factory.createProxy()`
4. Store `safeProxyAddress` in `tradingWallets` table

The Safe has threshold=1, with the Privy embedded wallet as sole owner.

**Auto-funding**: Before trades, the system checks Safe USDT balance and transfers from EOA if needed (reserves 50% + 5% for Predict leg).

### Deposit Watcher

**`deposit-watcher.ts`**: Polls every 30s, reads on-chain USDT/BNB balances for all registered wallets, detects increases, and records deposit events in the DB.

### Withdrawal Processor

**`withdrawal.ts`**: Executes withdrawals via Privy's delegated signing:
- BNB: native `sendTransaction`
- USDT: encoded `ERC20.transfer()` call
- Daily limit: 1000 USDT equivalent (BNB converted at ~600 USDT)

---

## Frontend

**Stack**: Next.js 14 (app router), React 18, Tailwind CSS, React Query, Privy SDK

### Pages

| Route | Purpose |
|-------|---------|
| `/login` | Privy sign-in (email/social) |
| `/onboarding` | 4-step wizard: welcome -> fund wallet -> configure -> ready |
| `/dashboard` | Agent control (start/stop), metrics (balance, P&L, trades), live spreads, recent trades |
| `/markets` | Searchable list of all live arbitrage opportunities with expandable details |
| `/trades` | Paginated trade history with expandable leg details |
| `/wallet` | Deposit (copy address), withdraw (USDT/BNB), export private key, deposit history |
| `/settings` | Trade sizing, profit margins, daily loss limit, max trades, resolution window |

### Data Flow

```
Frontend (React Query)
  │
  ├─► Platform API (:4000) — authenticated with Privy bearer token
  │   ├── useProfile()       (10s refetch)
  │   ├── useWallet()        (15s refetch)
  │   ├── useAgentStatus()   (3s refetch)
  │   ├── useMarkets()       (10s refetch)
  │   └── useTrades()        (on-demand)
  │
  └─► Agent Proxy (/api/agent/* -> :3001)
      ├── useOpportunities() (3s refetch)
      └── usePositions()     (5s refetch)
```

### Design

Dark theme with cyan (#00D4FF) accent. Skeleton loaders for async data. Status badges with color coding by severity. Responsive sidebar with mobile toggle.

---

## Database Schema

**PostgreSQL + Drizzle ORM** (`packages/shared/src/db/schema.ts`)

```
users
├── id (text PK) — Privy user ID
├── walletAddress (text, unique)
├── createdAt, lastLoginAt

tradingWallets
├── id (text PK)
├── userId (FK -> users)
├── address (text, unique) — Privy embedded wallet
├── privyWalletId (text) — for delegated signing
├── safeProxyAddress (text, nullable) — Gnosis Safe for Probable
├── createdAt

userConfigs
├── id (text PK)
├── userId (FK -> users, unique)
├── minTradeSize (bigint, default 5 USDT)
├── maxTradeSize (bigint, default 100 USDT)
├── minSpreadBps (int, default 100)
├── maxSpreadBps (int, default 400)
├── maxTotalTrades (int, nullable)
├── tradingDurationMs (bigint, nullable)
├── dailyLossLimit (bigint, default 50 USDT)
├── maxResolutionDays (int, nullable)
├── agentStatus (text, default "stopped")
├── updatedAt

deposits
├── id (text PK)
├── userId (FK -> users)
├── txHash (text, unique)
├── token (text) — USDT | BNB
├── amount (numeric 78,0)
├── confirmedAt

withdrawals
├── id (text PK)
├── userId (FK -> users)
├── toAddress, token, amount, txHash
├── status (text) — pending | processing | confirmed | failed
├── createdAt, processedAt

trades
├── id (text PK)
├── userId (FK -> users)
├── marketId (text)
├── status (text) — OPEN | PARTIAL | FILLED | CLOSED | EXPIRED
├── legA, legB (jsonb) — full order + fill details
├── totalCost, expectedPayout, spreadBps, pnl (bigint)
├── openedAt, closedAt
├── Indexes: userId, marketId

markets
├── id (text PK)
├── conditionId, title, category
├── probableMarketId, predictMarketId
├── resolvesAt, lastUpdatedAt
├── Index: conditionId
```

---

## On-Chain Addresses

All on BNB Chain (chainId 56).

### CLOB Exchanges

| Platform | Address |
|----------|---------|
| Probable | `0xf99f5367ce708c66f0860b77b4331301a5597c86` |
| Predict (Standard) | `0x8BC070BEdAB741406F4B1Eb65A72bee27894B689` |
| Predict (NegRisk) | `0x365fb8...` |
| Predict (Yield) | `0x6bEb5a...` |
| Predict (Yield+NegRisk) | `0x8A289d...` |

### Gnosis CTF (Conditional Token Framework)

| Platform | Address |
|----------|---------|
| Probable | `0x364d05055614B506e2b9A287E4ac34167204cA83` |
| Predict | `0x22DA1810B194ca018378464a58f6Ac2B10C9d244` |
| Opinion | `0xAD1a38cEc043e70E83a3eC30443dB285ED10D774` |

### Tokens

| Token | Address |
|-------|---------|
| USDT (BSC) | `0x55d398326f99059fF775485246999027B3197955` |

### Infrastructure

| Contract | Address |
|----------|---------|
| Safe Proxy Factory | `0xB99159aBF0bF59a512970586F38292f8b9029924` |

---

## State Persistence

**File-based** (`packages/agent/src/persistence.ts`)

```typescript
interface PersistedState {
  tradesExecuted: number;
  positions: Position[];         // Vault mode
  clobPositions: ClobPosition[]; // CLOB mode
  clobNonces: Record<string, string>;  // Platform -> nonce (prevents replay)
  lastScan: number;
}
```

Atomic write (`.tmp` -> rename). Saved after every trade + at graceful shutdown. Bigints serialized as strings. Non-critical failures logged but don't crash the agent.

On startup, persisted nonces are restored to prevent EIP-712 order replay across restarts.
