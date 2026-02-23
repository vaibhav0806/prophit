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

### What's NOT Built

| Component | Status | Reason |
|-----------|--------|--------|
| **XO Market adapter** | Not started | Bonding curve architecture, lower priority |
| **Bento adapter** | Not started | UGC markets, early access, lower priority |
| **Opinion live integration** | Blocked | Waiting for API key |
| **BSC mainnet deployment** | Not started | Needs P0 fixes + testnet validation first |
| **Multi-sig ownership** | Not started | Required for production |
| **Proxy/upgradeable contracts** | Not started | Decision needed |
| **Auto-discovery pipeline** | Partial | `discoverEvents()` method added to ProbableProvider; full auto-match + auto-wire pipeline not built |
| **On-chain trade execution via CLOB** | Not started | Adapters do CTF split/merge but don't place limit orders on Probable/Predict CLOBs |
| **Predict.fun Cloudflare bypass** | Workaround | REST API blocked by Cloudflare; GraphQL works from browser context only |

### Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| ProphitVault.t.sol | 19 (incl. fuzz) | All passing |
| OpinionAdapter.t.sol | 30 | All passing |
| PredictAdapter.t.sol | 30 | All passing |
| ProbableAdapter.t.sol | 35 | All passing |
| Agent unit tests | 82 | All passing |
| **Total** | **196** | **All passing** |

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

### P0 — Must Fix Before Launch

#### Agent

| # | Issue | Detail | Fix |
|---|-------|--------|-----|
| 1 | **No duplicate trade prevention** | Same opportunity executes on consecutive scans if prices haven't moved | Track recently executed opportunities with hash dedup (marketId + protocols), 5-min cooldown window |
| 2 | **`Promise.all` kills all quotes on single provider failure** | One API timeout = entire scan returns 0 quotes | Switch to `Promise.allSettled`, use only fulfilled results |
| 3 | **No fee accounting in detector** | Predict.fun charges 200bps. Detector shows "profitable" spreads that lose money after fees | Subtract protocol fees from spread calculation. Make fee schedule configurable per provider |
| 4 | **Orderbook validation missing** | 0 price, crossed books, empty books, stale timestamps all treated as valid quotes | Validate: price > 0 && price < 1, asks sorted, timestamp < 60s, minimum liquidity threshold |
| 5 | **MockProviders always instantiated** | Test mock providers run alongside real providers in production | Gate behind `USE_MOCK_PROVIDERS=true` or `chainId === 31337` |
| 6 | **Non-atomic persistence** | `writeFileSync` crash mid-write corrupts state file → positions lost on restart | Write to `.tmp` then `rename()` (atomic on POSIX) |
| 7 | **No agent-side loss limits** | Agent keeps trading even if vault is bleeding money | Track cumulative PnL, pause if daily loss exceeds threshold |
| 8 | **No position size vs liquidity check** | May try to buy more than orderbook depth | Check orderbook liquidity before sizing position |

#### Contracts

| # | Issue | Detail | Fix |
|---|-------|--------|-----|
| 9 | **`resetDailyLoss()` has no timelock** | Owner can reset loss counter instantly, bypassing circuit breaker | Add 24h timelock or remove manual reset entirely (auto-reset only) |
| 10 | **`setAgent()` is instant** | Compromised owner can hijack agent role and drain vault in one tx | Implement 2-step agent update with timelock (like `Ownable2Step`) |

#### Frontend/Infra

| # | Issue | Detail | Fix |
|---|-------|--------|-----|
| 11 | **Hardcoded `localhost` fallbacks** | Missing env vars silently default to `localhost:3001` / `127.0.0.1:8545` | Require env vars in production (throw on missing) |

### P1 — Should Fix

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 1 | Agent | Graceful shutdown doesn't wait for in-flight scans or flush state | Await current scan completion, save state, close HTTP server |
| 2 | Agent | No `/api/health` endpoint | Add health check returning last scan time + provider statuses |
| 3 | Agent | Gas estimation uses hardcoded 400k, no wallet balance check | Use `estimateGas()`, verify BNB balance before execution |
| 4 | Agent | No market expiration checks | Skip markets expiring within 24h |
| 5 | Agent | LLM prompt injection via market descriptions | Sanitize untrusted API data before passing to OpenAI |
| 6 | Agent | No API rate limiting on agent endpoints | Add middleware rate limiter |
| 7 | Contracts | Adapter removal traps open positions | Prevent removal while positions reference that adapter |
| 8 | Contracts | 1:1 share split assumption may fail on real CTF | Verify actual shares returned vs expected after `splitPosition()` |
| 9 | Contracts | Positions array grows unbounded | Add archival mechanism or use mapping-based storage |
| 10 | Contracts | No upgrade path (immutable contracts) | Consider UUPS proxy for vault, or plan migration strategy |
| 11 | Contracts | `block.timestamp` daily reset vulnerable to MEV | Use `block.number / blocksPerDay` instead |
| 12 | Frontend | Aggressive polling (2-3s) with no backoff when agent is down | Exponential backoff, pause when tab hidden |
| 13 | Frontend | API proxy has no path whitelisting | Whitelist allowed agent API endpoints |
| 14 | Infra | Docker containers run as root | Add `USER node` directive |
| 15 | Infra | CI missing lint, security scan, deploy step | Add eslint, `npm audit`, container build+push |

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

### Phase 1: P0 Fixes (~1-2 days)
- [ ] Agent: duplicate trade prevention (dedup window)
- [ ] Agent: `Promise.allSettled` for providers
- [ ] Agent: fee accounting in detector (200bps Predict.fun fee must be subtracted from spread)
- [ ] Agent: orderbook validation (price bounds, staleness, min liquidity)
- [ ] Agent: conditional MockProvider instantiation (gate behind `USE_MOCK_PROVIDERS=true`)
- [ ] Agent: atomic state persistence (write to `.tmp` then `rename()`)
- [ ] Agent: agent-side daily loss limit
- [ ] Agent: position size vs liquidity check (compare order size against orderbook depth)
- [ ] Contracts: timelock on `resetDailyLoss()`
- [ ] Contracts: 2-step `setAgent()` with delay
- [ ] Frontend: require env vars in production mode

### Phase 2: Execution Path (~2-3 days)
- [ ] Implement CLOB order placement for Probable (EIP-712 signed orders via API)
- [ ] Implement CLOB order placement for Predict.fun (signed orders via API)
- [ ] Handle Predict.fun Cloudflare protection for programmatic API access
- [ ] Wire adapter `buyOutcome` to actual CLOB orders (not just CTF split/merge)
- [ ] Auto-discovery pipeline: fetch all events from both platforms, auto-match, auto-wire market maps

### Phase 3: BSC Testnet Validation (~2-3 days)
- [ ] Deploy vault + all 3 adapters to BSC testnet
- [ ] Test against real Gnosis CTF contract (not mocks)
- [ ] Verify `splitPosition` / `mergePositions` / `redeemPositions` work with real CTF token IDs
- [ ] Run agent against live Predict.fun + Probable APIs for 48-72h
- [ ] Monitor for: stale quotes, API failures, gas spikes, position lifecycle issues
- [ ] Verify circuit breakers fire correctly under real conditions

### Phase 4: Security Hardening (~1-2 days)
- [ ] Deploy with multi-sig owner (Gnosis Safe)
- [ ] Add timelock for all admin operations
- [ ] Fix P1 items (graceful shutdown, health checks, gas estimation, etc.)
- [ ] Consider external audit for vault contract

### Phase 5: Mainnet Launch
- [ ] Deploy to BSC mainnet with small capital ($100-500 USDT)
- [ ] Monitor for 24-48h before scaling
- [ ] Gradually increase position size limits
- [ ] Add monitoring/alerting (P2 items)

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

Execution
  ├── VaultClient       ── viem wrapper for ProphitVault (simulate + execute)
  └── Executor          ── gas check → simulate → execute → track

API (Hono on :3001)
  ├── GET  /api/status
  ├── GET  /api/opportunities
  ├── GET  /api/positions
  ├── GET  /api/yield
  ├── POST /api/agent/start|stop
  └── POST /api/config
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
| **Predict.fun** | `graphql.predict.fun/graphql` | Cloudflare JS challenge | BSC (56) | 200 bps | Custom | Cursor-based, 445 markets |
| **Probable** | Orderbooks: `api.probable.markets`, Events: `market-api.probable.markets` | None (public) | BSC (56) | 0 bps | UMA Optimistic Oracle | Offset-based, limit=100 max, 135 events/468 markets |
| **Opinion** | `openapi.opinion.trade/openapi` | `apikey` header | BSC (56) | ~1-3% dynamic | Opinion AI | Unknown (blocked on API key) |

All three use **Gnosis Conditional Token Framework (CTF)** — ERC1155 outcome tokens on BSC.

### Contract Addresses (BSC Mainnet)

| Contract | Probable | Predict.fun | Opinion |
|----------|----------|-------------|---------|
| CTF Token | `0x364d05055614B506e2b9A287E4ac34167204cA83` | TBD | `0xAD1a38cEc043e70E83a3eC30443dB285ED10D774` |
| CTF Exchange | `0x616C31a93769e32781409518FA2A57f3857cDD24` | TBD | TBD |
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

### Fee Accounting (TODO — P0 fix needed)

```
Predict.fun: 200 bps on each leg
Probable:    0 bps
Opinion:     ~100-300 bps dynamic

Effective min spread = sum_of_fees + (2 * gas_cost) + margin
Example: Predict + Probable = 200 + 0 + ~1 + 50 margin ≈ 251 bps minimum
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
        matching/{embedder,cluster,verifier,risk-assessor,index}.ts
        yield/{scorer,allocator,rotator,types}.ts
        api/server.ts
        scripts/{discover-markets,match-markets}.ts
    frontend/               # Next.js 14
      src/app/{scanner,positions,agent,unifier,yield,audit}/page.tsx
      src/components/{scanner,positions,agent,unifier,yield,audit,sidebar}.tsx
      src/hooks/{use-agent-api,use-vault}.ts
      src/lib/{contracts,chains,format}.ts
```
