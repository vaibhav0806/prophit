# Prophet: Development Plan

## One-liner

Autonomous AI agent that continuously scans prediction markets on BNB Chain (Predict.fun, Probable, Opinion Labs) for price discrepancies on the same events, executes delta-neutral arbitrage trades to capture risk-free profit — all from a multi-tenant SaaS dashboard.

## Current Status (Feb 28, 2026)

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
| **Frontend Dashboard** | Done | Markets browser, trades, agent control, wallet, settings, onboarding |
| **Market Titles & Links** | Done | Titles from discovery, per-platform links (Predict, Probable, Opinion) |
| **Trade Enrichment** | Done | Trades JOIN markets for title/category/resolvesAt |
| **Nonce Persistence** | Done | Restored on restart, auto-incremented per order |
| **Graceful Shutdown** | Done | SIGTERM/SIGINT cancels open orders, flushes state |
| **Health Endpoint** | Done | `GET /api/health` with rate limit bypass |
| **Yield Rotation** | Done | Position scoring (risk-adjusted APY), Half-Kelly allocator, rotation suggestions |
| **Architecture Doc** | Done | Comprehensive `ARCHITECTURE.md` covering all subsystems |
| **Telegram Bot** | Done | Grammy bot, 11 commands, trade notifications, account linking |
| **MCP Server** | Done | Claude Desktop/Code integration, 10 tools, browser-based auth |
| **CLI** | Done | Interactive REPL, 12 commands, tab completion, shared MCP credentials |
| **Frontend Rebrand** | Done | Serif typography (Cormorant Garamond), dark trading terminal aesthetic |

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

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full deep-dive covering all subsystems (scanner, matching engine, arbitrage detection, execution, CLOB clients, adapters, liquidity checks, yield rotation, platform API, wallet infrastructure, frontend, database schema, on-chain addresses).

### Quick Reference

```
packages/
  agent/         Arbitrage engine (discovery, matching, detection, execution)
  platform/      Multi-tenant API (auth, agent mgmt, wallet custody, scanner)
  frontend/      Next.js 14 dashboard (opportunities, trades, agent control, wallet)
  telegram/      Telegram bot (Grammy, agent control, notifications)
  mcp/           MCP server (Claude Desktop/Code integration)
  cli/           Interactive REPL CLI (terminal-based agent control)
  shared/        Drizzle ORM schema, shared types, migrations
  contracts/     Solidity vault + protocol adapters (Foundry)
```

### Core Loop

```
Scanner (5s) → Providers fetch orderbooks → QuoteStore
  → AgentInstance.scan() → detectArbitrage(quotes)
  → Filter: 50-400 bps, dedup, daily loss limit
  → Execute: unreliable leg (Probable/Opinion) FOK first
  → If filled: reliable leg (Predict) FOK
  → Persist trade to DB, track position
```

### Interface Channels

```
Frontend (Privy bearer token)    →  Platform API (:4000)
Telegram Bot (X-Telegram-Chat-Id) → Platform API (:4000)
MCP Server (X-User-Wallet)      →  Platform API (:4000)
CLI (X-User-Wallet)              →  Platform API (:4000)
```

---

## Test Results

| Package | Tests | Status |
|---------|-------|--------|
| Agent (matching, discovery, CLOB, executor, detector, providers, yield) | 450 | 5 failing (probable-client Safe validation) |
| Frontend (hooks, formatting, API) | 52 | All passing |
| **Total** | **502** | |

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

### Phase 4: Yield, Health, Architecture
- [x] `/api/health` endpoint with rate limit bypass
- [x] Yield rotation module (scorer, allocator, rotator)
- [x] Position scoring by risk-adjusted annualized return
- [x] Half-Kelly capital allocation for new opportunities
- [x] Rotation suggestions with exit cost analysis
- [x] Comprehensive ARCHITECTURE.md documentation

### Phase 5: Multi-Channel Access
- [x] Telegram bot with Grammy (11 commands: start, help, status, run, stop, balance, opportunities, positions, config, set, logout)
- [x] Telegram account linking flow (/link-telegram frontend page)
- [x] Trade notification server (HTTP :4100, push trade events to linked Telegram users)
- [x] MCP server for Claude Desktop/Code integration (10 tools via stdio transport)
- [x] MCP browser-based auth flow (/mcp-link page → local callback → ~/.prophet/credentials.json)
- [x] CLI interactive REPL (node:readline/promises, 12 commands, tab completion, chalk output)
- [x] CLI shares credentials + auth flow with MCP (~/.prophet/credentials.json, X-User-Wallet)
- [x] X-User-Wallet header auth in platform middleware (wallet-based auth for MCP/CLI)
- [x] Frontend rebrand: Cormorant Garamond serif typography, Prophet "P" logo SVG
- [x] Markets → Opportunities rename throughout UI
- [x] Dashboard redesign: wallet info, copy address, BSCScan link, fund via Privy, export key

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
| 3 | Market resolution monitoring (auto-redeem settled positions) | 4h |
| 4 | Position expiration handling (near-expiry warnings) | 2h |
| 5 | Fix 5 failing probable-client Safe validation tests | 1h |

### Medium Priority

| # | Task | Effort |
|---|------|--------|
| 1 | CLOB client integration tests (mocked fetch) | 4h |
| 2 | Frontend mobile responsiveness | 4h |
| 3 | Post-execution slippage tracking (actual vs estimated) | 2h |
| 4 | Provider health scoring (skip unhealthy APIs) | 2h |
| 5 | Rate limiting per-user on agent endpoints | 1h |

### Low Priority / Nice to Have

| # | Task |
|---|------|
| 1 | Prometheus metrics / Grafana dashboards |
| 2 | Deploy contracts to BSC mainnet (vault + adapters) |
| 3 | Multi-sig ownership for vault |
| 4 | XO Market / Bento adapters |
| 5 | CSP headers on frontend |
| 6 | Docker multi-stage builds for production |

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
