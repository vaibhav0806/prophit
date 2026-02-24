# Prophit: AI Arbitrage Agent for Prediction Markets on BNB Chain

## One-liner

Autonomous AI agent that continuously scans prediction markets on BNB Chain (Opinion, Predict.fun, Probable) for price discrepancies on the same events, executes delta-neutral arbitrage trades to capture risk-free profit, and rotates yield across markets based on risk-adjusted returns — all from a single dashboard.

## Current Status

### What's Built & Working

| Component | Status | Notes |
|-----------|--------|-------|
| **ProphitVault.sol** | Done | Capital pool, circuit breakers (daily limits, cooldown, position cap), pausable, 2-step ownership |
| **IProtocolAdapter** | Done | Unified interface: `getQuote`, `buyOutcome`, `sellOutcome`, `redeem`, `isResolved` |
| **OpinionAdapter.sol** | Done | CTF split/merge, owner-set quotes, access control (30 tests) |
| **PredictAdapter.sol** | Done | CTF split/merge, owner-set quotes, access control (30 tests) |
| **ProbableAdapter.sol** | Done | CTF split/merge, owner-set quotes (rewritten from AMM to CLOB) (35 tests) |
| **MockAdapter + MockUSDT** | Done | Full lifecycle mocks for local E2E testing |
| **Agent core loop** | Done | Scan → detect → simulate → execute → close resolved |
| **PredictProvider** | Done | Live API integration, orderbook parsing, tested with real data |
| **ProbableProvider** | Done | Live CLOB API, orderbook parsing, paginated event discovery (135 events/468 markets) |
| **OpinionProvider** | Done | Code ready, blocked on API key |
| **Cross-protocol detection** | Done | Shared marketId mapping, 19 markets wired (3 NBA + 15 FIFA WC + 1 Greenland) |
| **AI Semantic Matching** | Done | OpenAI embeddings + GPT-4o-mini verification (optional, needs OPENAI_API_KEY) |
| **Yield Rotation** | Done | Half-Kelly sizing, position scoring, rotation suggestions (log-only) |
| **Frontend (7 pages)** | Done | Scanner, Positions, Agent Control, Unifier, Yield, Audit, sidebar nav |
| **REST API** | Done | Status, opportunities, positions, yield, start/stop, config — Bearer auth |
| **Docker** | Done | Multi-stage builds, docker-compose for dev + prod |
| **CI/CD** | Done | GitHub Actions: contracts (forge), agent (tsc + vitest), frontend (next build) |
| **State persistence** | Done | JSON file, auto-restore on restart |
| **Market discovery scripts** | Done | `discover-markets.ts`, `match-markets.ts` for Predict.fun |
| **CLOB types + EIP-712 signing** | Done | Shared `ClobOrder` struct, `signOrder()`, `signClobAuth()` via viem `signTypedData` |
| **Probable CLOB client** | Done | EIP-712 signed orders, Prob_* L2 HMAC auth, order/cancel/approvals, API key derivation, Safe proxy wallet support (execTransaction) |
| **Predict.fun CLOB client** | Done | JWT auth flow, EIP-712 signed orders, 401 re-auth, order/cancel/approvals |
| **Fill polling** | Done | `pollForFills()` — polls both legs every 5s for 60s, handles FILLED/PARTIAL/EXPIRED, cancels unfilled on timeout |
| **CLOB position redemption** | Done | `closeResolvedClob()` — checks CTF `payoutDenominator`, calls `redeemPositions`, updates status to CLOSED |
| **Signing validation script** | Done | `validate-signing.ts` — CLI for testing EIP-712 signing against real APIs (validated against both Probable + Predict.fun) |
| **CLOB execution mode** | Done | `EXECUTION_MODE=clob` bypasses vault, EOA signs+places limit orders directly on CLOBs |
| **Auto-discovery pipeline** | Done | Fetch all markets from both platforms, match by conditionId + title similarity, output market maps |
| **Auto-discover CLI** | Done | `npx tsx src/scripts/auto-discover.ts [--dry-run] [--save]` |
| **CLOB positions tracking** | Done | `ClobPosition` lifecycle (OPEN→PARTIAL→FILLED→CLOSED→EXPIRED), persisted to state |
| **CLOB API endpoints** | Done | `GET /api/clob-positions`, `POST /api/discovery/run` |

### What's NOT Built

| Component | Status | Reason |
|-----------|--------|--------|
| **XO Market adapter** | Not started | Bonding curve architecture, lower priority |
| **Bento adapter** | Not started | UGC markets, early access, lower priority |
| **Opinion live integration** | Blocked | Waiting for API key |
| **BSC mainnet deployment** | Not started | Needs blocker fixes + signing validation first |
| **Multi-sig ownership** | Not started | Required for production |
| **Proxy/upgradeable contracts** | Not started | Decision needed |
| **CLOB client integration tests** | Not started | Need mocked fetch or testnet; unit tests pass but no HTTP-level tests for probable-client/predict-client |
| **Predict.fun signing validation** | Done | EIP-712 signing verified against live API — domain, exchange, scale, fees all correct |
| **Probable signing validation** | Done | EIP-712 + HMAC L2 signing verified against live API — order placed (ID 24422), cancelled. Safe proxy wallet (`0x0EA05eB5`), domain "Probable CTF Exchange", scale 1e18, feeRateBps 175 min |
| **Probable `authenticate()` call** | Fixed | Added to `index.ts` IIFE |
| **CLOB daily loss reads BNB not USDT** | Fixed | Replaced with ERC-20 balanceOf |
| **Safe proxy wallet flow** | Done | `execSafeTransaction()` — EIP-712 SafeTx signing, CTF + USDT approvals via Safe, receipt-based nonce management |
| **Nonce reset on restart** | Not started | Nonce starts at 0n on each restart, server may reject duplicate nonce |
| **USDT balance pre-check** | Not started | No check that wallet has enough USDT before placing orders |
| **Graceful shutdown** | Not started | No await for in-flight scans or state flush on SIGTERM |

### Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| ProphitVault.t.sol | 26 (incl. fuzz + timelock) | All passing |
| OpinionAdapter.t.sol | 30 | All passing |
| PredictAdapter.t.sol | 30 | All passing |
| ProbableAdapter.t.sol | 35 | All passing |
| Agent unit tests | 123 (incl. 39 CLOB/signing/discovery) | All passing |
| **Total** | **244** | **All passing** |

### Live API Validation

**Full market scan (Feb 24, 2026):**

- Probable: 135 events, 468 markets (paginated via offset, max 100/page)
- Predict.fun: 445 markets (GraphQL API, cursor-based pagination)
- Cross-matched with 9 strategies: 45 truly equivalent market pairs found

**19 markets wired for live cross-protocol detection:**

| Category | Count | Markets |
|----------|-------|---------|
| NBA games | 3 | Spurs/Pistons, Kings/Grizzlies, Jazz/Rockets |
| FIFA World Cup | 15 | Spain, England, France, Argentina, Brazil, Portugal, Germany, Netherlands, Italy, Norway, Japan, Belgium, Morocco, Croatia, Mexico |
| Geopolitics | 1 | Trump acquires Greenland before 2027 |

**Live arbitrage opportunities found (5):**

| Market | Cost | Profit | ROI | Strategy |
|--------|------|--------|-----|----------|
| Portugal wins FIFA WC | $0.967 | $0.0144 | 1.5% | Buy Predict YES @$0.068 + Probable NO @$0.899 |
| Brazil wins FIFA WC | $0.972 | $0.0097 | 1.0% | Buy Predict YES @$0.083 + Probable NO @$0.889 |
| Japan wins FIFA WC | $0.973 | $0.0072 | 0.7% | Buy Predict YES @$0.011 + Probable NO @$0.962 |
| Trump acquires Greenland | $0.978 | $0.0040 | 0.4% | Buy Predict YES @$0.100 + Probable NO @$0.878 |
| Italy wins FIFA WC | $0.979 | $0.0013 | 0.1% | Buy Predict YES @$0.016 + Probable NO @$0.963 |

10+ additional markets within 0.5 cents of breakeven (Netherlands, Spain, Croatia, England, etc.).

**Key insight:** Predict.fun YES prices are consistently cheaper than Probable's for low-probability outcomes. Liquidity is thin — best ask levels are 10-50 shares before price jumps.

**Additional overlap categories found but NOT yet wired (different question types):**

| Category | Probable markets | Predict.fun markets | Issue |
|----------|-----------------|---------------------|-------|
| Crypto prices (BTC/ETH/BNB/SOL) | 56 | 40+ | Different thresholds, wide bid-ask on low-prob |
| Token launch/FDV | 175+ | 100+ | "Will X launch" vs "X FDV above $Y" — different questions |
| Stock prices (TSLA/AAPL/NVDA etc.) | 60 | 0 | Predict.fun doesn't have stock markets |
| Silver/Gold | 16 | 16 | Same category but wide spreads eat any edge |

---

## Production Readiness Audit

### Phase 1 P0s — All Fixed ✓

All original P0 issues from the initial audit have been fixed:

| # | Issue | Status | Commit |
|---|-------|--------|--------|
| 1 | Duplicate trade prevention | Fixed | `6bfeba7` |
| 2 | `Promise.allSettled` for providers | Fixed | `6bfeba7` |
| 3 | Fee accounting in detector | Fixed | `6bfeba7` |
| 4 | Orderbook validation | Fixed | `6bfeba7` |
| 5 | MockProvider gating | Fixed | `6bfeba7` |
| 6 | Atomic state persistence | Fixed | `6bfeba7` |
| 7 | Agent-side loss limits | Fixed | `6bfeba7` |
| 8 | Position size vs liquidity check | Fixed | `6bfeba7` |
| 9 | `resetDailyLoss()` timelock | Fixed | `4e335f1` |
| 10 | 2-step `setAgent()` | Fixed | `4e335f1` |
| 11 | Hardcoded localhost fallbacks | Fixed | `c148a24` |

---

### Mainnet Deployment Blockers (Feb 24, 2026)

#### Tier 1 — Hard Blockers (must fix before any real money)

| # | Area | Issue | Detail | Fix | Effort |
|---|------|-------|--------|-----|--------|
| 1 | Agent | **`authenticate()` never called for Probable** | `index.ts` IIFE calls `fetchNonce()` but NOT `authenticate()` — first placeOrder throws "L2 auth not initialized" | Add `await probableClobClient.authenticate()` before `fetchNonce()` in IIFE | 5 min |
| 2 | Agent | **CLOB daily loss reads BNB, not USDT** | `executor.ts` uses `publicClient.getBalance()` (returns BNB wei) for CLOB mode loss tracking. Should read USDT ERC-20 balance | Replace `getBalance()` with `readContract({ address: BSC_USDT, functionName: "balanceOf" })` | 30 min |
| 3 | Agent | **EIP-712 domain never validated against live API** | Signing code matches Polymarket spec on paper but no real order has been accepted. Domain separator, struct hash, field ordering unproven | Run `validate-signing.ts` against Probable + Predict.fun with funded wallet | Blocked on wallet |
| 4 | Agent | **Mock providers still instantiate on chainId 31337** | `.env` has `CHAIN_ID=31337` (Hardhat). MockProvider code path activates. Must be `CHAIN_ID=56` for mainnet | Flip to `CHAIN_ID=56` + real BSC RPC URL. Hard-block mock instantiation if `CHAIN_ID !== 31337` | 10 min |
| 5 | Agent | **API unauthenticated** | `API_KEY` defaults to empty string (`""`) — all endpoints are open. Anyone with the URL can start/stop agent, view positions | Require non-empty `API_KEY` in config, throw on startup if missing | 15 min |
| 6 | Agent | **CLOB lazy init race** | CLOB clients are initialized inside an IIFE with no await gate — scan loop can start before auth/nonce complete | `await` the CLOB init promise before starting scan interval | 30 min |
| 7 | Contracts | **`DeployProduction.s.sol` incomplete** | Script exists but doesn't deploy adapters, register markets, or set approvals. No BSC fork config in `foundry.toml` | Complete deploy script with full adapter deploy + market registration + approval grants. Add `[profile.bsc]` to foundry.toml | 4-8 hrs |
| 8 | Contracts | **No market registration flow** | Adapters have `setQuote()` per marketId but no script/function to register all 19+ wired markets on-chain | Add batch `registerMarket` script that sets initial quotes for all configured markets | 2-4 hrs |

#### Tier 2 — High Risk — All Agent Items Fixed ✓

| # | Area | Issue | Status | Commit |
|---|------|-------|--------|--------|
| 1 | Agent | **Partial fill — no remediation** | Fixed | `3fea99a` — Executor auto-pauses on PARTIAL, `isPaused()`/`unpause()` for operator control |
| 2 | Agent | **Nonce reset on restart** | Fixed | `3fea99a` — Nonces persisted to state file via `getNonce()`/`setNonce()`, restored on startup |
| 3 | Agent | **No USDT balance pre-check** | Fixed | `3444ba4` — EOA USDT balance checked before placing CLOB orders |
| 4 | Agent | **Graceful shutdown missing** | Fixed | `3fea99a` — SIGTERM/SIGINT handler cancels open orders, flushes state, exits cleanly |
| 5 | Agent | **Float precision in order amounts** | Fixed | `3fea99a` — Two-step scaling (float*1e8 then BigInt/100_000_000n) avoids IEEE 754 loss |
| 6 | Agent | **JWT expiry race (Predict.fun)** | Fixed | `3fea99a` — Promise-based mutex on `ensureAuth()`, JWT expiry tracking with 30s buffer |
| 7 | Contracts | **`setCircuitBreakers` has no timelock** | Not started | Add timelock or require multi-sig for circuit breaker changes |
| 8 | Infra | **npm audit vulnerabilities** | Not started | Run `npm audit fix`, upgrade vulnerable deps |

#### Tier 3 — Medium Priority (fix before production scale)

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 1 | Agent | No `/api/health` endpoint | Add health check returning last scan time + provider statuses |
| 2 | Agent | Gas estimation uses hardcoded 400k | Use `estimateGas()`, verify BNB balance before vault execution |
| 3 | Agent | No market expiration checks | Skip markets expiring within 24h |
| 4 | Agent | LLM prompt injection via market descriptions | Sanitize untrusted API data before passing to OpenAI |
| 5 | Agent | No API rate limiting on agent endpoints | Add middleware rate limiter |
| 6 | Contracts | Adapter removal traps open positions | Prevent removal while positions reference that adapter |
| 7 | Contracts | 1:1 share split assumption may fail on real CTF | Verify actual shares returned vs expected after `splitPosition()` |
| 8 | Contracts | Positions array grows unbounded | Add archival mechanism or use mapping-based storage |
| 9 | Contracts | No upgrade path (immutable contracts) | Consider UUPS proxy for vault, or plan migration strategy |
| 10 | Frontend | Aggressive polling (2-3s) with no backoff | Exponential backoff, pause when tab hidden |
| 11 | Frontend | API proxy has no path whitelisting | Whitelist allowed agent API endpoints |
| 12 | Infra | Docker containers run as root | Add `USER node` directive |
| 13 | Infra | CI missing lint, security scan, deploy step | Add eslint, `npm audit`, container build+push |

### P2 — Nice to Have

| # | Issue |
|---|-------|
| 1 | Prometheus metrics / observability (provider latency, gas trends, PnL tracking) |
| 2 | Webhook alerting (Slack/Discord) for critical errors and trade executions |
| 3 | Post-execution slippage tracking (actual vs estimated) |
| 4 | CSP headers on frontend |
| 5 | Mobile-responsive tables (card layout on small screens) |
| 6 | Emergency withdrawal function for stuck adapter funds |
| 7 | Position expiration monitoring (auto-close near-expiry) |
| 8 | Provider health scoring (skip unhealthy APIs across scans) |
| 9 | Config hot-reload atomicity (shallow copy on update) |

---

## Pre-Launch Checklist

### Phase 1: P0 Fixes — DONE ✓
- [x] Agent: duplicate trade prevention (dedup window) — `6bfeba7`
- [x] Agent: `Promise.allSettled` for providers — `6bfeba7`
- [x] Agent: fee accounting in detector (200bps Predict.fun fee subtracted from spread) — `6bfeba7`
- [x] Agent: orderbook validation (price bounds, min liquidity) — `6bfeba7`
- [x] Agent: conditional MockProvider instantiation (gated behind `USE_MOCK_PROVIDERS=true` / chainId 31337) — `6bfeba7`
- [x] Agent: atomic state persistence (write to `.tmp` then `renameSync()`) — `6bfeba7`
- [x] Agent: agent-side daily loss limit — `6bfeba7`
- [x] Agent: position size vs liquidity check (90% cap per leg) — `6bfeba7`
- [x] Contracts: 24h timelock on `resetDailyLoss()` (request/execute/cancel) — `4e335f1`
- [x] Contracts: 2-step `setAgent()` with 24h delay (propose/accept/cancel) — `4e335f1`
- [x] Frontend: warn on missing env vars (throws break `next build` SSG) — `c148a24`

### Phase 2: CLOB Execution & Auto-Discovery — DONE ✓
- [x] CLOB types + EIP-712 signing (`clob/types.ts`, `clob/signing.ts`) — shared order struct, `signOrder()`, `signClobAuth()`, `buildHmacSignature()`
- [x] Probable CLOB client (`clob/probable-client.ts`) — Prob_* L2 HMAC auth, API key derivation, order placement, cancel, approval txs
- [x] Predict.fun CLOB client (`clob/predict-client.ts`) — JWT auth flow, order placement with 401 re-auth, approval txs
- [x] `EXECUTION_MODE=clob` wiring — executor mode switch, EOA signs orders directly (bypasses vault), EOA balance for loss limit
- [x] Auto-discovery pipeline (`discovery/pipeline.ts`) — fetch both platforms, conditionId match + Jaccard title similarity (>0.85)
- [x] Auto-discover CLI (`scripts/auto-discover.ts`) — `npx tsx src/scripts/auto-discover.ts [--dry-run] [--save]`
- [x] CLOB position persistence (`clobPositions` array in state file)
- [x] API endpoints — `GET /api/clob-positions`, `POST /api/discovery/run`
- [x] Unit tests — 39 tests (order construction, serialization, constants, title similarity, execution mode)
- [x] Handle Predict.fun Cloudflare — REST API is NOT blocked (only browser scraping); confirmed working
- [x] Fill polling (`pollForFills`) — polls both legs every 5s for 60s, handles FILLED/PARTIAL/EXPIRED states
- [x] CLOB position redemption (`closeResolvedClob`) — checks CTF `payoutDenominator`, calls `redeemPositions`
- [x] Signing validation script (`validate-signing.ts`) — CLI for testing against real APIs
- [x] Signing validation against real APIs — both Probable + Predict.fun orders placed + cancelled on live BSC mainnet
- [ ] **Remaining:** CLOB client integration tests (mocked fetch)

### Phase 2.5: Tier 1 Blocker Fixes — DONE ✓ (except contracts)
- [x] Add `probableClobClient.authenticate()` to `index.ts` IIFE (Tier 1 #1) — `f2253c7`
- [x] Fix CLOB daily loss to read USDT balance, not BNB (Tier 1 #2) — `f2253c7`
- [x] Validate EIP-712 signing against live Probable + Predict.fun APIs (Tier 1 #3) — both platforms validated, orders placed + cancelled
- [x] Set `CHAIN_ID=56` + real BSC RPC, hard-block mocks on mainnet (Tier 1 #4) — `f2253c7`
- [x] Require non-empty `API_KEY` on startup (Tier 1 #5) — `f2253c7`
- [x] Await CLOB init before starting scan loop (Tier 1 #6) — `f2253c7`
- [ ] Complete `DeployProduction.s.sol` + BSC foundry config (Tier 1 #7)
- [ ] Market registration script for on-chain adapters (Tier 1 #8)

### Phase 2.6: Probable Live Validation — DONE ✓
- [x] Crack HMAC L2 signing — server re-serializes body with schema-defined key order (deferExec, order{salt,maker,...,signature}, owner, orderType)
- [x] Fix Probable exchange address: `0xf99f5367ce708c66f0860b77b4331301a5597c86` (was wrong)
- [x] Fix EIP-712 domain name: "Probable CTF Exchange" (not "ClobExchange")
- [x] Fix amount scaling: 1e18 (not Polymarket's 1e6)
- [x] Fix minimum feeRateBps: 175 (1.75%)
- [x] Deploy Safe proxy wallet for EOA (`0x0EA05eB5f9221EEd7E675FceF49c93C5fa1D9406`)
- [x] Implement Safe `execTransaction` flow — EIP-712 SafeTx signing, receipt-based nonce management
- [x] Route CTF + USDT approvals through Safe when `PROBABLE_PROXY_ADDRESS` is set
- [x] Place order on live API — Order #24422, status NEW, symbol NBASASDE1642YESUSDT
- [x] Fix `cancelOrder` — DELETE `/order/{chainId}/{orderId}?tokenId={tokenId}` (required query param)
- [x] Cancel lingering orders — both 24421 + 24422 cancelled successfully

### Phase 3: BSC Mainnet Validation
- [x] Fund EOA wallet with BNB (gas) + USDT (trading capital) — EOA funded, 2 USDT transferred to Safe
- [x] Run `validate-signing.ts --platform probable --cancel` — order placed + cancelled on Probable
- [x] Run `validate-signing.ts --platform predict --cancel` — order placed + cancelled on Predict.fun
- [x] Run `ensureApprovals()` — CTF + USDT approvals set for Probable exchange (via Safe)
- [ ] Deploy vault + all 3 adapters to BSC mainnet
- [ ] Register all 19+ wired markets on adapters
- [ ] Run agent in `DRY_RUN=true` mode for 24h against live APIs
- [ ] Verify: no stale quotes, no API failures, no signing rejections
- [ ] Switch to `DRY_RUN=false` with $100 USDT
- [ ] Monitor for 48h: position lifecycle, fill rates, PnL tracking

### Phase 4: Security Hardening
- [x] Fix Tier 2 agent blockers — partial fill pause, graceful shutdown, nonce persistence, USDT balance check, float precision, JWT mutex — `3444ba4`, `3fea99a`
- [ ] Deploy with multi-sig owner (Gnosis Safe)
- [ ] Add timelock for `setCircuitBreakers`
- [ ] Fix Tier 3 items (health endpoint, gas estimation, rate limiting, etc.)
- [ ] Consider external audit for vault contract

### Phase 5: Scale
- [ ] Gradually increase position size limits ($500 → $1000 → $5000)
- [ ] Add monitoring/alerting (Prometheus, Slack webhooks)
- [ ] Expand to additional market categories (crypto prices, token launches)
- [ ] Wire Opinion.trade when API key arrives

---

## Architecture

### Smart Contracts (Solidity 0.8.24, Foundry, OpenZeppelin v5)

```
ProphitVault.sol
  ├── deposit/withdraw (owner)
  ├── openPosition (agent only, circuit breakers)
  ├── closePosition (agent only)
  ├── pause/unpause (owner)
  └── setAgent, approveAdapter, removeAdapter (owner)

IProtocolAdapter (interface)
  ├── getQuote(marketId) → (yesPrice, noPrice, yesLiq, noLiq, resolved)
  ├── buyOutcome(marketId, isYes, amount) → shares
  ├── sellOutcome(marketId, isYes, shares) → usdt
  ├── redeem(marketId) → usdt
  └── isResolved(marketId) → bool

OpinionAdapter   ── CTF split/merge, owner-set quotes from CLOB API
PredictAdapter   ── CTF split/merge, owner-set quotes from CLOB API
ProbableAdapter  ── CTF split/merge, owner-set quotes from CLOB API
```

### Agent (Node.js 20, TypeScript, viem, Hono)

```
Providers (fetch live prices)
  ├── MockProvider      ── reads from on-chain MockAdapter
  ├── OpinionProvider   ── Opinion REST API (CLOB orderbooks)
  ├── PredictProvider   ── Predict.fun REST API (CLOB orderbooks)
  └── ProbableProvider  ── Probable REST API (CLOB orderbooks, no auth, paginated event discovery)

Arbitrage Detector
  └── Groups quotes by shared marketId → checks all protocol pairs → finds spreads < $1.00

AI Matching (optional, needs OPENAI_API_KEY)
  ├── Embedder          ── text-embedding-3-small, in-memory cache
  ├── Cluster           ── cosine similarity (0.85 threshold), cross-protocol only
  ├── Verifier          ── GPT-4o-mini confirmation
  └── Risk Assessor     ── LLM risk scoring per opportunity

Yield Rotation (optional)
  ├── Scorer            ── risk-adjusted position scoring
  ├── Allocator         ── half-Kelly criterion capital allocation
  └── Rotator           ── rotation suggestions when yield improvement > threshold

CLOB Clients (direct EOA order placement)
  ├── ClobTypes         ── shared EIP-712 order struct, ClobClient interface
  ├── Signing           ── buildOrder, signOrder, signClobAuth via viem signTypedData
  ├── ProbableClobClient── Prob_* L2 HMAC auth, API key derivation, order/cancel, approvals
  └── PredictClobClient ── JWT auth flow, order placement, 401 re-auth, approvals

Execution
  ├── VaultClient       ── viem wrapper for ProphitVault (simulate + execute)
  └── Executor          ── mode switch: vault (on-chain) or clob (EOA → CLOB API)

Discovery
  ├── Pipeline          ── fetch all markets from both platforms, match, output maps
  └── CLI               ── npx tsx src/scripts/auto-discover.ts [--dry-run] [--save]

API (Hono on :3001)
  ├── GET  /api/status
  ├── GET  /api/opportunities
  ├── GET  /api/positions
  ├── GET  /api/clob-positions
  ├── GET  /api/yield
  ├── POST /api/agent/start|stop
  ├── POST /api/config
  └── POST /api/discovery/run
```

### Frontend (Next.js 14, wagmi v2, shadcn/ui, TanStack Query)

```
Pages
  ├── /scanner      ── live opportunities table with spread badges
  ├── /positions    ── active positions with P&L, vault balance
  ├── /agent        ── start/stop, config sliders, log viewer
  ├── /unifier      ── cross-protocol market view with filter pills
  ├── /yield        ── capital allocation, summary cards
  └── /audit        ── chronological trade log
```

### Key Protocol Details

| Protocol | API | Auth | Chain | Fees | Oracle | Pagination |
|----------|-----|------|-------|------|--------|------------|
| **Predict.fun** | `api.predict.fun` (REST) | `x-api-key` + JWT bearer | BSC (56) | 200 bps | Custom | Cursor-based, 445 markets |
| **Probable** | Orderbooks: `api.probable.markets`, Events: `market-api.probable.markets` | Public (read), Prob_* HMAC L2 (write) | BSC (56) | 175 bps min | UMA Optimistic Oracle | Offset-based, limit=100 max, 135 events/468 markets |
| **Opinion** | `openapi.opinion.trade/openapi` | `apikey` header | BSC (56) | ~1-3% dynamic | Opinion AI | Unknown (blocked on API key) |

All three use **Gnosis Conditional Token Framework (CTF)** — ERC1155 outcome tokens on BSC.

### Contract Addresses (BSC Mainnet)

| Contract | Probable | Predict.fun | Opinion |
|----------|----------|-------------|---------|
| CTF Token | `0x364d05055614B506e2b9A287E4ac34167204cA83` | `0xC5d01939Af7Ce9Ffc505F0bb36eFeDde7920f2dc` | `0xAD1a38cEc043e70E83a3eC30443dB285ED10D774` |
| CTF Exchange | `0xf99f5367ce708c66f0860b77b4331301a5597c86` | `0x8BC070BEdAB741406F4B1Eb65A72bee27894B689` | TBD |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | same | same |

---

## Core Mechanism

### Cross-Market Arbitrage

```
Real example (Feb 24, 2026 — Portugal wins FIFA WC):

Market A (Predict.fun):  YES ask = $0.068   NO ask = $0.932
Market B (Probable):     YES ask = $0.109   NO ask = $0.899

Strategy: Buy YES on Predict ($0.068) + Buy NO on Probable ($0.899)
Total cost: $0.068 + $0.899 = $0.967
Predict.fun fee: 2% on profit of winning leg ≈ $0.019
Guaranteed payout: $1.00
Net profit: $1.00 - $0.967 - $0.019 = $0.014 (1.5% ROI)

Key: Predict.fun YES is cheaper than Probable's ($0.068 vs $0.109).
Probable NO is cheap enough ($0.899) that combined cost < $1.00 even after fees.
```

### Detection Formula

```
spread_bps = (1.0 - (best_yes_price + best_no_price)) * 10000

If spread_bps > min_threshold:
  net_profit = spread * position_size - gas_costs - protocol_fees
  If net_profit > 0: EXECUTE
```

### Fee Accounting

```
Predict.fun: 200 bps on profit of winning leg (worst-case deducted in detector)
Probable:    175 bps minimum (1.75%)
Opinion:     200 bps (estimated, pending API key confirmation)

Detector computes worst-case fee per strategy:
  worstCaseFee = max(feeIfYesWins, feeIfNoWins)
  where feeIfYesWins = (1.0 - yesPrice) * feeBps / 10000

spreadBps is NET (after fees); grossSpreadBps stores pre-fee value.
Opportunities where fees >= gross spread are skipped.
```

---

## Repo Structure

```
prophit/
  package.json              # pnpm workspace root
  pnpm-workspace.yaml
  PLAN.md                   # this file
  README.md
  docker-compose.yml        # dev (anvil + contracts + agent + frontend)
  docker-compose.prod.yml   # prod (agent + frontend)
  .github/workflows/ci.yml
  packages/
    contracts/              # Foundry
      src/
        ProphitVault.sol
        interfaces/IProtocolAdapter.sol
        adapters/{Opinion,Predict,Probable}Adapter.sol
        mocks/{MockAdapter,MockUSDT}.sol
      test/
        ProphitVault.t.sol
        {Opinion,Predict,Probable}Adapter.t.sol
      script/Deploy.s.sol
    agent/                  # Node.js/TypeScript
      src/
        index.ts, config.ts, types.ts, logger.ts, utils.ts
        providers/{base,mock-provider,opinion-provider,predict-provider,probable-provider}.ts
        arbitrage/detector.ts
        execution/{vault-client,executor}.ts
        clob/{types,signing,probable-client,predict-client}.ts
        matching/{embedder,cluster,verifier,risk-assessor,index}.ts
        yield/{scorer,allocator,rotator,types}.ts
        discovery/pipeline.ts
        api/server.ts
        scripts/{discover-markets,match-markets,auto-discover,validate-signing,probe-probable}.ts
    frontend/               # Next.js 14
      src/app/{scanner,positions,agent,unifier,yield,audit}/page.tsx
      src/components/{scanner,positions,agent,unifier,yield,audit,sidebar}.tsx
      src/hooks/{use-agent-api,use-vault}.ts
      src/lib/{contracts,chains,format}.ts
```
