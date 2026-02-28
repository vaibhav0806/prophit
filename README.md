<p align="center">
  <img src="logo.svg" width="120" height="120" alt="Prophet logo" />
</p>

<h1 align="center">Prophet</h1>

<p align="center">
  Autonomous arbitrage agent for BNB Chain prediction markets.<br/>
  Detects price discrepancies across Predict.fun, Probable, and Opinion Labs CLOBs,<br/>
  then executes delta-neutral trades to capture risk-free profit.
</p>

<p align="center">
  <a href="#access-prophet">Access</a> · <a href="#how-it-works">How It Works</a> · <a href="#supported-platforms">Platforms</a> · <a href="#quick-start">Quick Start</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="docs/user-journey.md">User Journey</a> · <a href="PLAN.md">Plan</a>
</p>

---

## Architecture

> Full deep-dive: **[ARCHITECTURE.md](./ARCHITECTURE.md)**

```
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │   Frontend   │  │ Telegram Bot │  │  MCP Server  │  │     CLI      │
     │  (Dashboard) │  │  (Grammy)    │  │  (Claude)    │  │   (REPL)     │
     │  Next.js     │  │  :4100       │  │  stdio       │  │  readline    │
     └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
            │ Privy bearer    │ Bot secret      │ X-User-Wallet   │ X-User-Wallet
            │                 │ X-Telegram-     │                 │
            │                 │  Chat-Id        │                 │
            └────────┬────────┴─────────────────┴─────────────────┘
                     │
              ┌──────▼───────┐
              │   Platform   │  Hono :4000
              │     API      │  User mgmt, wallet custody, agent lifecycle
              └──┬───────┬───┘
                          │       │
             ┌────────────▼─┐   ┌─▼──────────────┐
             │   Scanner    │   │  Agent Manager │
             │   Service    │   │  (per-user)    │
             └──────┬───────┘   └────────┬───────┘
                    │                    │
             ┌──────▼───────┐   ┌────────▼────────┐
             │  Quote Store │   │ Agent Instance  │
             │  (in-memory) │──►│  scan() loop    │
             └──────────────┘   │  every 5s       │
                                └────────┬────────┘
                                         │
                   ┌─────────────────────┬┴──────────────────────┐
                   │                     │                       │
            ┌──────▼──────┐    ┌────────▼────────┐    ┌────────▼────────┐
            │  Arbitrage  │    │    Executor     │    │  Yield Rotator  │
            │  Detector   │    │  (Vault/CLOB)   │    │  (optional)     │
            └─────────────┘    └───┬────┬────┬───┘    └─────────────────┘
                                   │    │    │
                             ┌──────▼┐ ┌─▼──┐ ┌▼───────┐
                             │Predict│ │Prob│ │Opinion │  CLOB Clients
                             │Client │ │able│ │Client  │  (EIP-712 orders)
                             └───────┘ └────┘ └────────┘
                                    │    │    │
                             ───────────────────────────  BNB Chain
                             Gnosis CTF  │  CLOB Exchanges  │  Safe Proxy
```

## Access Prophet

| Channel | Link |
|---------|------|
| Web Dashboard | `localhost:3000` (self-hosted) |
| Telegram Bot | [@pr0phet_bot](https://t.me/pr0phet_bot) |
| CLI | `pnpm build:cli && cd packages/cli && pnpm start` |
| MCP (Claude) | See [MCP Server](#mcp-server) setup below |

## How It Works

If the same binary event is priced differently across two platforms, you can buy YES on one and NO on the other. When the combined cost is less than $1.00, the profit is guaranteed regardless of outcome.

```
Example: "Will Portugal win FIFA World Cup?"

  Predict.fun:  YES = $0.068
  Probable:     NO  = $0.899
  Total cost:   $0.967
  Payout:       $1.00
  Profit:       $0.014 (1.5% ROI, after 2% + 1.75% fees)
```

The agent finds these spreads automatically, matches equivalent markets across platforms using the matching engine, and executes both legs sequentially — unreliable leg first (Probable/Opinion), reliable leg (Predict) only if the first fills.

## What's Novel

**Problem**: BNB Chain has 3 prediction market CLOBs (Predict, Probable, Opinion Labs) that list the same events under different titles, different IDs, and different orderbook formats. Price discrepancies of 50-400 bps exist continuously, but no tooling exists to detect or exploit them — manual monitoring is impractical across 2,500+ markets.

**Our solution** introduces three techniques we haven't seen elsewhere:

1. **3-pass cross-platform market matching** — Markets across platforms use different titles for the same event ("Will Portugal win?" vs "Portugal to win FIFA WC 2026?"). Our matching engine uses conditionId matching, template extraction with entity/params normalization (Unicode confusable replacement, NFKD, year stripping), and composite similarity (max of Jaccard + bigram Dice at 0.85 threshold) with a template guard to prevent false positives. Production result: **102 matches from ~2,500 markets, 0 false positives**.

2. **Zero-cost failure execution model** — Arbitrage agents typically risk capital on the first leg. We execute the unreliable leg first (Probable/Opinion — thin orderbooks, frequent FOK failures) before the reliable leg (Predict — deep liquidity). If the unreliable leg fails, total cost is $0. This is a non-obvious inversion of the typical "reliable first" strategy.

3. **AI-native trading interface via MCP** — Prophet exposes a Model Context Protocol server, allowing users to monitor and control their arbitrage agent through natural language via Claude. This is a first for DeFi trading agents — no other prediction market tool has an MCP integration.

Additionally: Privy embedded wallets with delegated signing (users never manage private keys), Gnosis Safe proxy auto-deployment for Probable's signatureType requirement, and a Telegram bot for mobile-first agent control.

## Supported Platforms

| Platform    | Type | Fees    | Auth                | Status |
|-------------|------|---------|---------------------|--------|
| Predict.fun | CLOB | 200 bps | API key + JWT       | Live   |
| Probable    | CLOB | 175 bps | HMAC L2 + Safe proxy| Live   |
| Opinion Labs| CLOB | 200 bps | API key             | Live   |

All three use Gnosis Conditional Token Framework (CTF) — ERC-1155 outcome tokens on BSC.

## Quick Start

```bash
# Install
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Start all services (platform, frontend, agent, telegram)
pnpm dev

# Or individually:
cd packages/platform && pnpm dev   # API (port 4000)
cd packages/frontend && pnpm dev   # Frontend (port 3000)
cd packages/telegram && pnpm dev   # Telegram bot (port 4100)

# CLI (interactive REPL)
pnpm build:cli && cd packages/cli && pnpm start
```

Requires a `.env` in each package — see `.env.example` files.

## Project Structure

```
packages/
  agent/         Arbitrage engine: discovery, matching, detection, execution
  platform/      Multi-tenant API: auth, agent mgmt, wallet custody, scanner
  frontend/      Next.js dashboard: opportunities, trades, agent control, wallet
  telegram/      Telegram bot: agent control, balance, spreads, trade notifications
  mcp/           MCP server: Claude Desktop/Code integration (stdio transport)
  cli/           Interactive REPL CLI: terminal-based agent control
  shared/        Drizzle ORM schema, shared types, migrations
  contracts/     Solidity vault + protocol adapters (Foundry, not used in prod — CLOB APIs are faster)
```

### Agent Package

```
src/
  matching-engine/     3-pass market matcher (conditionId, template, similarity)
    normalizer.ts      Unicode confusable replacement, NFKD, year stripping
    index.ts           Jaccard + Dice similarity, template extraction, matchMarkets()
  discovery/
    pipeline.ts        Fetch all 3 platforms, run matching, build market maps
  clob/
    predict-client.ts  Predict.fun CLOB (JWT auth, EIP-712 orders)
    probable-client.ts Probable CLOB (HMAC L2, Safe proxy, nonce mgmt)
    opinion-client.ts  Opinion CLOB (API key auth, ERC-1155 settlement)
  providers/           MarketProvider implementations (fetch orderbook quotes)
  arbitrage/
    detector.ts        Cross-protocol spread detection with fee accounting
  execution/
    executor.ts        Sequential execution: unreliable leg first, then reliable
```

### Platform Package

```
src/
  api/
    server.ts          Hono app: CORS, rate limiting, auth middleware
    routes/            /auth, /agent, /wallet, /trades, /markets, /me
  agents/
    agent-manager.ts   Per-user agent lifecycle (start/stop, CLOB client init)
  scanner/
    service.ts         Continuous quote fetching from all 3 platforms
    quote-store.ts     In-memory quote + title + link storage
  wallets/
    deposit-watcher.ts On-chain deposit monitoring
    withdrawal.ts      Privy-signed withdrawal processing
  auth/
    middleware.ts       Privy token verification
```

### Telegram Bot

```
src/
  bot.ts                 Grammy bot setup, command registration
  api-client.ts          Platform API client (X-Telegram-Chat-Id auth)
  commands/
    start.ts             /start — link account or show welcome
    help.ts              /help — list all commands
    status.ts            /status — agent running state
    run.ts               /run — start trading agent
    stop.ts              /stop — stop trading agent
    balance.ts           /balance — wallet balances
    spreads.ts           /opportunities — live arbitrage spreads
    positions.ts         /positions — open trades
    config.ts            /config & /set — view/update trading config
    logout.ts            /logout — unlink account
  notifications/
    server.ts            HTTP server (:4100) for trade notifications
    formatter.ts         HTML message formatting
```

### MCP Server

```
src/
  index.ts               MCP server (stdio transport), tool registration
  api-client.ts          Platform API client (X-User-Wallet auth)
```

Tools exposed: `login`, `logout`, `get_profile`, `get_status`, `start_agent`, `stop_agent`, `get_balance`, `get_opportunities`, `get_positions`, `update_config`.

Auth flow: `login` → opens browser to `/mcp-link` → user signs in via Privy → wallet address posted back to local callback server → saved to `~/.prophet/credentials.json`.

### CLI

```
src/
  index.ts               Entry point: banner, REPL loop (node:readline/promises)
  api-client.ts          Platform API client (X-User-Wallet auth, same as MCP)
  commands.ts            12 command handlers (login, status, start, stop, etc.)
  formatter.ts           Chalk-colored terminal output formatting
```

Interactive REPL with tab completion. Commands: `login`, `logout`, `status`, `start`, `stop`, `balance`, `opportunities`, `positions`, `config`, `config set <key> <val>`, `help`, `exit`.

Auth flow: same as MCP — `login` opens browser to `/mcp-link`, saves wallet to `~/.prophet/credentials.json`. Shares credentials with MCP server.

### Frontend Pages

| Route             | Description                                        |
|-------------------|--------------------------------------------------  |
| `/login`          | Privy sign-in (email/social)                       |
| `/onboarding`     | 4-step wizard: welcome, fund, configure, launch    |
| `/dashboard`      | Agent control, wallet info, live spreads, recent trades |
| `/markets`        | Filterable opportunity browser with protocol logos  |
| `/trades`         | Trade history with expandable leg details           |
| `/wallet`         | USDT/BNB balances, deposit address, withdrawals     |
| `/settings`       | Trade sizing, profit margins, daily loss limit      |
| `/link-telegram`  | Link Telegram account to Prophet                   |
| `/mcp-link`       | Link Claude Desktop/Code via MCP callback          |

## Matching Engine

Markets across platforms use different titles for the same event. The matching engine finds equivalent pairs using a 3-pass algorithm:

1. **conditionId** — Exact hash match (same underlying CTF condition)
2. **Template extraction** — Pattern-based matching (e.g. "Will X launch a token by Y?") with entity/params normalization
3. **Composite similarity** — max(Jaccard word-level, Dice bigram) above 0.85 threshold, with a template guard to prevent false positives

Normalization handles Unicode confusables (Cyrillic/Greek lookalikes), NFKD decomposition, year stripping, and digit separator collapsing.

Production results: **102 matches** from ~2,500 markets across 3 platforms, 0 false positives.

For the full deep-dive on every subsystem, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Execution Model

```
1. Scanner fetches quotes every 5s from all providers
2. Agent detects spread > minSpreadBps (50 bps default)
3. Spread filter: 50-400 bps band (below = noise, above = likely false match)
4. Execute unreliable leg first (Probable/Opinion — thin orderbooks, FOK)
5. If filled → execute reliable leg (Predict — deeper liquidity)
6. If unreliable leg fails → $0 cost, move on
7. Track position: OPEN → FILLED → CLOSED on resolution
```

## Configuration

Key environment variables:

| Variable              | Description                           | Default  |
|-----------------------|---------------------------------------|----------|
| `PREDICT_API_KEY`     | Predict.fun API key                   | required |
| `OPINION_API_KEY`     | Opinion Labs API key                  | optional |
| `DISABLE_PROBABLE`    | Skip Probable provider                | false    |
| `MIN_SPREAD_BPS`      | Minimum spread to trade               | 50       |
| `MAX_SPREAD_BPS`      | Maximum spread (filters false matches)| 400      |
| `SCAN_INTERVAL_MS`    | Quote polling interval (ms)           | 5000     |
| `DRY_RUN`             | Log trades without executing          | false    |
| `DAILY_LOSS_LIMIT`    | Max daily loss in USDT                | 50       |
| `DATABASE_URL`        | PostgreSQL connection string          | required |
| `PRIVY_APP_ID`        | Privy auth app ID                     | required |
| `PRIVY_APP_SECRET`    | Privy auth secret                     | required |
| `TELEGRAM_BOT_TOKEN`  | Telegram bot token from @BotFather   | required |
| `TELEGRAM_BOT_SECRET` | Shared secret for bot↔platform auth  | required |
| `TELEGRAM_NOTIFY_PORT`| Notification webhook port            | 4100     |
| `USER_WALLET_ADDRESS` | MCP: wallet address (skips browser auth) | optional |

## Testing

```bash
pnpm test                    # all packages
pnpm --filter agent test     # agent only (450+ tests)
pnpm --filter frontend test  # frontend only (52 tests)
```

Key test suites:
- `matching-engine.test.ts` — Normalization, similarity, template extraction, regression cases
- `discovery.test.ts` — Pipeline, multi-platform matching
- `executor-clob.test.ts` — Sequential execution, fill polling, partial fill handling
- `detector.test.ts` — Spread detection, fee accounting
- `providers.test.ts` — Quote fetching, liquidity calculation
- `yield.test.ts` — Position scoring, Kelly allocation, rotation

## Tech Stack

| Layer    | Technologies                                             |
|----------|----------------------------------------------------------|
| Agent    | Node.js 22, TypeScript, viem                             |
| Platform | Hono, Drizzle ORM, PostgreSQL, Privy SDK                 |
| Frontend | Next.js 14, React 18, TanStack Query, Tailwind CSS      |
| Telegram | Grammy (Telegram Bot API), Node.js HTTP server           |
| MCP      | @modelcontextprotocol/sdk, stdio transport               |
| CLI      | node:readline/promises, chalk                            |
| Auth     | Privy (embedded wallets, delegated signing)              |
| Chain    | BSC mainnet (56), Gnosis CTF (ERC-1155)                  |

## BNB Chain Integration

Prophet operates natively on **BNB Chain (BSC mainnet, chainId 56)** using [viem](https://viem.sh) for all on-chain interactions.

### On-Chain Protocols

| Protocol | Usage | Contract |
|---|---|---|
| **Gnosis CTF** (ERC-1155) | Conditional token framework — outcome tokens for all 3 platforms | `0x364d...` / `0x22DA...` / `0xAD1a...` |
| **Gnosis Safe** | 1-of-1 proxy wallets for Probable CLOB orders (signatureType 2) | Factory: `0xB991...` |
| **BSC USDT** (BEP-20) | Collateral for all trades — approvals, transfers, balance tracking | `0x55d3...9955` |
| **Predict Exchange** | EIP-712 signed limit orders (Standard + NegRisk + Yield variants) | `0x8BC0...` |
| **Probable Exchange** | EIP-712 signed orders via Safe proxy (HMAC L2 auth) | `0xf99f...` |
| **Opinion Exchange** | EIP-712 signed orders (API key auth) | — |

### On-Chain Operations

- **EIP-712 order signing** — typed data signatures for all 3 CLOB platforms (different domain separators)
- **ERC-20 approvals** — `approve(MAX_UINT256)` to exchange + CTF contracts for USDT
- **ERC-1155 approvals** — `setApprovalForAll` for CTF outcome tokens
- **Safe proxy deployment** — deterministic `createProxy()` via Probable's factory, threshold=1 owner=EOA
- **Safe transaction execution** — `execTransaction()` for approvals + order placement through Safe
- **Balance monitoring** — `USDT.balanceOf()` for deposit detection, daily loss tracking, auto-funding
- **Auto-fund Safe** — EOA auto-transfers USDT to Safe proxy when balance drops below position threshold

### Why CLOB APIs, Not On-Chain Contracts

`packages/contracts/` contains a ProphetVault + 3 protocol adapter contracts (Foundry) that can execute trades atomically on-chain. However, **production uses CLOB APIs exclusively** — arbitrage is a speed game, and off-chain CLOB order placement (EIP-712 signed, settled by the exchange) is orders of magnitude faster than submitting on-chain transactions and waiting for block confirmation. All three platforms (Predict, Probable, Opinion) expose CLOB APIs that accept signed orders and settle on BSC, giving us sub-second execution vs ~3s block times.

The Solidity contracts remain as an alternative atomic execution path and demonstrate on-chain composability with Gnosis CTF.

Full address list in [ARCHITECTURE.md — On-Chain Addresses](./ARCHITECTURE.md#on-chain-addresses).

## Dependencies

Key open-source dependencies powering Prophet:

| Dependency | Version | Purpose |
|---|---|---|
| [Hono](https://hono.dev) | ^4.6.0 | Lightweight web framework for Platform API |
| [Next.js](https://nextjs.org) | 14.2.35 | React framework for frontend dashboard |
| [viem](https://viem.sh) | ^2.21.0 | TypeScript Ethereum client (BNB Chain interactions) |
| [Drizzle ORM](https://orm.drizzle.team) | ^0.38.4 | TypeScript ORM for PostgreSQL |
| [Privy SDK](https://privy.io) | ^0.9.0 / ^3.14.1 | Auth + embedded wallet custody (server + React) |
| [Grammy](https://grammy.dev) | ^1.31.0 | Telegram Bot API framework |
| [TanStack Query](https://tanstack.com/query) | ^5.90.21 | Data fetching & caching for React |
| [@modelcontextprotocol/sdk](https://modelcontextprotocol.io) | ^1.0.0 | MCP server for Claude integration |
| [Tailwind CSS](https://tailwindcss.com) | ^3.4 | Utility-first CSS framework |
| [Zod](https://zod.dev) | ^3.0.0 | Runtime schema validation |
| [chalk](https://github.com/chalk/chalk) | ^5.0.0 | Terminal string styling (CLI) |
| [dotenv](https://github.com/motdotla/dotenv) | ^16.6.1 | Environment variable loading |
| [postgres](https://github.com/porsager/postgres) | ^3.4.0 | PostgreSQL driver |

Full dependency lists in each `packages/*/package.json`.

## Deployment

All services can be started with a single command using Docker Compose:

```bash
# Start all services (platform, frontend, telegram)
docker compose up --build

# Or run in background
docker compose up -d --build
```

See individual Dockerfiles in `packages/platform/Dockerfile`, `packages/frontend/Dockerfile`, and `packages/telegram/Dockerfile`.

## Market Opportunity

Prediction markets are the fastest-growing vertical in crypto:

| Metric | Value |
|---|---|
| Global prediction market volume (2025) | **$50B+** |
| Monthly volume on BNB Chain platforms | **$2B+** |
| BNB Chain CLOBs | **3** (Predict.fun, Probable, Opinion Labs — more coming) |

**The problem is fragmentation.** The same event ("Will BTC hit $100K?") trades at $0.62 on one platform and $0.55 on another. Identical outcomes, mispriced across siloed orderbooks. These mispricings persist for **hours** because no cross-platform infrastructure exists — each CLOB has different APIs, signing schemes, and wallet requirements. The complexity of integrating 3 different platforms keeps arbitrageurs out.

**Why now?**
- Prediction markets have hit escape velocity — every chain is racing to build CLOBs. Fragmentation = arbitrage.
- Complexity is the moat — each CLOB has different signing schemes and wallet requirements. This keeps spreads alive.
- Infrastructure just matured — Privy embedded wallets, prediction market APIs, and CLOBs. This stack didn't exist 18 months ago.

## Business Model

We profit when our users profit — performance fee on realized arbitrage gains.

|  | Prophet | Manual Arb | CEX Bots |
|---|---|---|---|
| **Revenue** | Performance fee | N/A | Monthly subscription |
| **Risk** | Delta-neutral | Execution risk | Market risk |
| **Setup** | 2 minutes | Days | Hours |
| **Custody** | Non-custodial (Privy) | Self-managed | Custodial |
| **Markets** | 100+ pairs | 5-10 | N/A |

## Adoption & Growth Plan

**Phase 1 — Seed users (now)**
- Target audience: crypto-native traders already active on Predict.fun / Probable who want passive yield
- Distribution: Telegram bot as viral loop (share trade alerts), BNB Chain community channels
- Onboarding: 2-minute flow — sign in with email, fund wallet, start agent

**Phase 2 — Community & partnerships**
- Partner with BNB Chain prediction market platforms (we drive volume + liquidity to their orderbooks)
- Open-source the matching engine as a standalone library for ecosystem builders
- Community-driven market pair curation (flag false matches, suggest new platforms)

**Phase 3 — Platform expansion**
- Add new BNB Chain CLOBs as they launch (XO Market, Bento, etc.)
- Cross-chain expansion (Polygon prediction markets, Solana)
- API access for institutional arbitrageurs (higher rate limits, dedicated support)

## Roadmap

| Milestone | Timeline | Deliverable |
|---|---|---|
| **v1.0 — Production launch** | Done | 3-platform arbitrage agent, dashboard, Telegram bot, MCP server |
| **v1.1 — Resolution & tracking** | Q1 2026 | Auto-redeem settled positions, post-execution slippage tracking, P&L analytics |
| **v1.2 — Reliability** | Q1 2026 | Provider health scoring, mobile-responsive frontend, Prometheus metrics |
| **v1.3 — New platforms** | Q2 2026 | XO Market + Bento adapters, matching engine as standalone npm package |
| **v2.0 — Cross-chain** | Q3 2026 | Polygon prediction markets, cross-chain bridge integration |
| **v2.1 — Institutional** | Q4 2026 | API tier for institutional users, multi-wallet support, advanced risk controls |

## License

[MIT](./LICENSE)
