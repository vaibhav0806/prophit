# Prophet: Development Plan

## One-liner

Autonomous AI agent that continuously scans prediction markets on BNB Chain (Predict.fun, Probable, Opinion Labs) for price discrepancies on the same events, executes delta-neutral arbitrage trades to capture risk-free profit — all from a multi-tenant SaaS dashboard.

## Current Status (Feb 27, 2026)

### What's Built & Working

| Component | Status | Notes |
|-----------|--------|-------|
| **Multi-tenant Platform** | Done | Hono API on :4000, per-user agents, Privy auth, PostgreSQL |
| **Privy Wallet Custody** | Done | Embedded wallets, delegated signing, deposit watching |
| **PredictProvider** | Done | REST API, orderbook parsing, cursor-based pagination |
| **ProbableProvider** | Done | CLOB API, paginated event discovery, dead market tracking |
| **OpinionProvider** | Done | REST API, orderbook parsing, auto-discovery integration |
| **Predict CLOB Client** | Done | JWT auth, EIP-712 orders, 401 re-auth, approvals |
| **Probable CLOB Client** | Done | HMAC L2 auth, Safe proxy, nonce persistence, API key derivation |
| **Opinion CLOB Client** | Done | API key auth, ERC-1155 settlement, order placement |
| **Matching Engine** | Done | 3-pass (conditionId → template → similarity), Unicode normalization, template guard |
| **Discovery Pipeline** | Done | Fetches all 3 platforms, runs matching, builds market/title/link maps |
| **Arb Detection** | Done | Cross-protocol spread detection with fee accounting (Predict 2%, Probable 1.75%, Opinion 2%) |
| **Sequential Executor** | Done | Unreliable leg first → reliable leg, fill polling, partial fill unwind |
| **Spread Guardrails** | Done | minSpreadBps (50), maxSpreadBps (400), daily loss limit |
| **Frontend Dashboard** | Done | Markets browser, trades, agent control, wallet, protocol branding |
| **Market Titles & Links** | Done | Titles from discovery, per-platform links (Predict, Probable, Opinion) |
| **Trade Enrichment** | Done | Trades JOIN markets for title/category/resolvesAt |
| **Nonce Persistence** | Done | Restored on restart, auto-incremented per order |
| **Graceful Shutdown** | Done | SIGTERM/SIGINT cancels open orders, flushes state |

### Production Results (Feb 27, 2026)

| Metric | Value |
|--------|-------|
| Probable markets | 455 |
| Predict markets | 2,098 |
| Opinion markets | 87 (342 fetched, 87 active) |
| Total matches | 102 (92 Probable↔Predict, 2 Opinion↔Predict, 8 Opinion↔Probable) |
| False positives | 0 |
| Match time | ~10s |

### Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Sequential execution (unreliable first) | Probable/Opinion have thin orderbooks — FOK fails often. Failing the unreliable leg costs $0. |
| 3-pass matching with template guard | conditionIds don't overlap between platforms. Template guard prevents Dice false-positives (e.g. "Basel" vs "Based"). |
| Prefixed cache keys (`a:`/`b:`) | Both Probable and Predict use numeric IDs that overlap. Prevents template cache corruption. |
| Spread band 50-400 bps | Below 50 = noise/fees eat profit. Above 400 = likely false match or illiquid trap. |
| Privy embedded wallets | Users don't manage private keys. Delegated signing for CLOB orders. |

---

## Architecture

### Packages

```
packages/
  agent/         Arbitrage engine (discovery, matching, detection, execution)
  platform/      Multi-tenant API (auth, agent mgmt, wallet custody, scanner)
  frontend/      Next.js dashboard (markets, trades, agent control, wallet)
  shared/        Drizzle ORM schema, shared types, migrations
  contracts/     Solidity vault + protocol adapters (Foundry)
```

### Agent Core

```
Providers (fetch live orderbook quotes every 5s)
  ├── PredictProvider    — Predict.fun REST API
  ├── ProbableProvider   — Probable REST API (dead market tracking, shouldRetry)
  └── OpinionProvider    — Opinion Labs REST API

Matching Engine (packages/agent/src/matching-engine/)
  ├── normalizer.ts      — Unicode confusables, NFKD, year stripping, article stripping
  └── index.ts           — Jaccard + Dice similarity, template extraction, 3-pass matchMarkets()

Discovery Pipeline (packages/agent/src/discovery/pipeline.ts)
  └── runDiscovery()     — Fetch all 3 platforms → matchMarkets() → market/title/link maps

Arbitrage Detector (packages/agent/src/arbitrage/detector.ts)
  └── detectArbitrage()  — Cross-protocol spread detection, fee-adjusted, liquidity-checked

CLOB Clients (direct EOA order placement)
  ├── PredictClobClient  — JWT auth, EIP-712 signed orders
  ├── ProbableClobClient — HMAC L2 auth, Safe proxy, nonce persistence
  └── OpinionClobClient  — API key auth, ERC-1155 settlement

Executor (packages/agent/src/execution/executor.ts)
  └── RELIABLE_PLATFORMS — Unreliable leg first, reliable leg if first fills
```

### Platform API

```
Hono :4000
  ├── POST /api/auth/register|login   — Privy token auth
  ├── GET  /api/markets               — Live opportunities (title, links, spreads)
  ├── GET  /api/trades                — Trade history (JOIN markets for title/category)
  ├── POST /api/agent/start|stop      — Per-user agent lifecycle
  ├── GET  /api/agent/status          — Running state, trades executed, uptime
  ├── PATCH /api/me/config            — Update trade thresholds
  ├── GET  /api/wallet                — Balances, deposit history
  └── POST /api/wallet/withdraw       — Privy-signed withdrawal

ScannerService
  └── Fetches quotes from all 3 providers every 5s → QuoteStore

AgentManager
  └── Per-user AgentInstance with CLOB clients (Predict, Probable, Opinion)
```

### Frontend Pages

| Route | Description |
|-------|-------------|
| `/dashboard` | Agent overview, recent trades, PnL |
| `/markets` | Live market browser with protocol colors, links, prices, spread indicators |
| `/trades` | Trade history with market titles, expandable leg details |
| `/agent` | Start/stop agent, configure min/max spread, trade size |
| `/wallet` | USDT/BNB balances, deposit address, withdrawal requests |

### Protocol Details

| Protocol | API Base | Auth | Fees | Pagination |
|----------|----------|------|------|------------|
| Predict.fun | `api.predict.fun` | API key + JWT | 200 bps | Cursor-based |
| Probable | `api.probable.markets` / `market-api.probable.markets` | Public (read) / HMAC L2 (write) | 175 bps | Offset, limit 100 |
| Opinion Labs | `openapi.opinion.trade/openapi` | `apikey` header | 200 bps | Single page |

All use Gnosis CTF (ERC-1155 outcome tokens) on BSC mainnet (chain 56).

### Contract Addresses (BSC Mainnet)

| Contract | Probable | Predict.fun | Opinion |
|----------|----------|-------------|---------|
| CTF Token | `0x364d05055614B506e2b9A287E4ac34167204cA83` | `0xC5d01939Af7Ce9Ffc505F0bb36eFeDde7920f2dc` | `0xAD1a38cEc043e70E83a3eC30443dB285ED10D774` |
| CTF Exchange | `0xf99f5367ce708c66f0860b77b4331301a5597c86` | `0x8BC070BEdAB741406F4B1Eb65A72bee27894B689` | `0xAD1a38cEc043e70E83a3eC30443dB285ED10D774` |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | same | same |

---

## Core Mechanism

### Cross-Market Arbitrage

```
Real example (Feb 2026 — Portugal wins FIFA WC):

  Predict.fun:  YES = $0.068   NO = $0.932
  Probable:     YES = $0.109   NO = $0.899

  Strategy: Buy YES on Predict ($0.068) + Buy NO on Probable ($0.899)
  Total cost: $0.967
  Fees: Predict 2% on winning leg ≈ $0.019
  Guaranteed payout: $1.00
  Net profit: $0.014 (1.5% ROI)
```

### Detection Formula

```
grossSpreadBps = (1.0 - (bestYes + bestNo)) * 10000
worstCaseFee = max(feeIfYesWins, feeIfNoWins)
spreadBps = grossSpreadBps - feeBps    (net after fees)

If spreadBps in [minSpreadBps, maxSpreadBps]:
  EXECUTE (unreliable leg first)
```

### Matching Engine

```
Pass 1: conditionId exact match        (instant, but rarely matches across platforms)
Pass 2: Template extraction + match    ("Will X launch token by Y?" → entity:params key)
Pass 3: Composite similarity ≥ 0.85    (max of Jaccard + Dice, with template guard)

Normalization pipeline:
  1. Replace Unicode confusables (Cyrillic Ʌ→a, Ͻ→c, и→n)
  2. NFKD decomposition + strip combining marks
  3. Collapse digit separators (100,000 → 100000)
  4. Lowercase, strip punctuation
  5. Remove current-year tokens
  6. Collapse whitespace
```

---

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| Matching engine | 58 | All passing |
| Discovery pipeline | 27 | All passing |
| CLOB clients | ~20 | All passing |
| Executor | ~15 | All passing |
| Arbitrage detector | ~10 | All passing |
| Frontend | ~11 | All passing |
| **Total** | **~140+** | **All passing** |

---

## Completed Milestones

### Phase 1: Foundation
- [x] ProphetVault.sol + 3 protocol adapters (Opinion, Predict, Probable)
- [x] Agent core loop (scan → detect → simulate → execute)
- [x] CLOB types + EIP-712 signing
- [x] Probable CLOB client (HMAC L2, Safe proxy)
- [x] Predict.fun CLOB client (JWT auth, 401 re-auth)
- [x] Auto-discovery pipeline (conditionId + Jaccard matching)
- [x] AI semantic matching (OpenAI embeddings, optional)

### Phase 2: Multi-Tenant SaaS
- [x] PostgreSQL + Drizzle ORM (users, trades, deposits, withdrawals)
- [x] Privy auth (embedded wallets, delegated signing)
- [x] Platform API (Hono :4000, rate limiting, CORS)
- [x] Per-user agent management (AgentManager)
- [x] Deposit watching + withdrawal processing
- [x] Frontend rewrite (Next.js 15, Privy, TanStack Query)

### Phase 3: Opinion Labs + Matching Engine
- [x] Opinion CLOB client + provider
- [x] 3-platform discovery pipeline (Predict ↔ Probable ↔ Opinion)
- [x] Matching engine extraction (normalizer + 3-pass matcher)
- [x] Unicode confusable normalization (fixes BLACKPINK, MetaMask year, etc.)
- [x] Template guard anti-false-positive (Basel vs Based, Trump/GTA VI)
- [x] Prefixed cache keys (fix numeric ID collision between platforms)
- [x] Market titles + per-platform links in API + frontend
- [x] Trade enrichment (JOIN markets for title/category/resolvesAt)
- [x] Executor generalization (RELIABLE_PLATFORMS set, not hardcoded Predict/Probable)
- [x] Probable dead market tracking (skip 400s, shouldRetry in retry.ts)
- [x] Frontend markets page redesign (protocol branding, links, prices)
- [x] Frontend trades page (market titles, expandable legs, PnL fix)
- [x] minSpreadBps lowered to 50 bps (was 100)

### Incident Response
- [x] Feb 25 incident: deposit watcher bigint overflow, Probable isFillOrKill bug
- [x] Predict LIMIT order precision fixes (amount rounding, tick sizes)
- [x] Market cooldown persistence across restarts
- [x] Available shares check before unwind

---

## Remaining Work

### High Priority

| # | Task | Effort |
|---|------|--------|
| 1 | Reduce near-miss log noise (200+ entries per scan) | 1h |
| 2 | Remove debug match-detail logging from pipeline | 15min |
| 3 | Add `/api/health` endpoint with provider status | 1h |
| 4 | Market resolution monitoring (auto-redeem settled positions) | 4h |
| 5 | Position expiration handling (near-expiry warnings) | 2h |

### Medium Priority

| # | Task | Effort |
|---|------|--------|
| 1 | CLOB client integration tests (mocked fetch) | 4h |
| 2 | Frontend mobile responsiveness | 4h |
| 3 | Webhook alerting (Discord/Slack) for trades and errors | 2h |
| 4 | Post-execution slippage tracking (actual vs estimated) | 2h |
| 5 | Provider health scoring (skip unhealthy APIs) | 2h |
| 6 | Rate limiting per-user on agent endpoints | 1h |

### Low Priority / Nice to Have

| # | Task |
|---|------|
| 1 | Prometheus metrics / Grafana dashboards |
| 2 | Deploy contracts to BSC mainnet (vault + adapters) |
| 3 | Multi-sig ownership for vault |
| 4 | XO Market / Bento adapters |
| 5 | Position yield rotation (Kelly criterion rebalancing) |
| 6 | CSP headers on frontend |
| 7 | Docker multi-stage builds for production |

---

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `EXECUTION_MODE` | `vault` or `clob` | `clob` |
| `MIN_SPREAD_BPS` | Minimum spread to trade | 50 |
| `MAX_SPREAD_BPS` | Maximum spread (false match filter) | 400 |
| `SCAN_INTERVAL_MS` | Quote polling interval | 5000 |
| `DAILY_LOSS_LIMIT` | Max daily loss (USDT, 6 decimals) | 50000000 |
| `MAX_POSITION_SIZE` | Max USDT per trade (6 decimals) | 500000000 |
| `DRY_RUN` | Log orders without executing | false |
| `PREDICT_API_KEY` | Predict.fun API key | required |
| `PREDICT_API_BASE` | Predict.fun API URL | `https://api.predict.fun` |
| `PROBABLE_API_BASE` | Probable orderbook API | `https://api.probable.markets` |
| `PROBABLE_EVENTS_API_BASE` | Probable events API | `https://market-api.probable.markets` |
| `OPINION_API_KEY` | Opinion Labs API key | optional |
| `OPINION_API_BASE` | Opinion API URL | `https://openapi.opinion.trade/openapi` |
| `DISABLE_PROBABLE` | Skip Probable provider entirely | false |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `PRIVY_APP_ID` | Privy auth app ID | required |
| `PRIVY_APP_SECRET` | Privy auth secret | required |
| `RPC_URL` | BSC RPC endpoint | required |
