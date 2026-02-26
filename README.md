# Prophit

Autonomous arbitrage agent for BNB Chain prediction markets. Detects price discrepancies across Predict.fun, Probable, and Opinion Labs CLOBs, then executes delta-neutral trades to capture risk-free profit.

## Architecture

```
                        +-----------+
                        |  Frontend |  Next.js :3000
                        |  (Privy)  |  Dashboard, Markets, Trades, Wallet
                        +-----+-----+
                              |
                              | REST (Bearer token)
                              v
                     +--------+--------+
                     |    Platform     |  Hono :4000
                     |  (multi-tenant) |  Auth, Agent mgmt, Wallet custody
                     +--------+--------+
                              |
              +---------------+---------------+
              |               |               |
     +--------v--+    +------v------+   +----v--------+
     |  Scanner  |    |   Agent     |   |   Deposit   |
     |  Service  |    |   Manager   |   |   Watcher   |
     +--------+--+    +------+------+   +-------------+
              |               |
     (quotes every 5s)  (per-user agents)
              |               |
    +---------+---------+     |
    |         |         |     |
+---v---+ +---v----+ +--v--+ |
|Predict| |Probable| |Opin.| |
| CLOB  | | CLOB   | |CLOB | |
+-------+ +--------+ +-----+ |
    BSC mainnet (chain 56)    |
                              v
                  +---------------------+
                  |  Matching Engine     |
                  |  3-pass: conditionId |
                  |  -> template -> sim  |
                  +---------------------+
```

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

# Start platform API (port 4000)
cd packages/platform && pnpm dev

# Start frontend (port 3000)
cd packages/frontend && pnpm dev
```

Requires a `.env` in each package — see `.env.example` files.

## Project Structure

```
packages/
  agent/         Arbitrage engine: discovery, matching, detection, execution
  platform/      Multi-tenant API: auth, agent mgmt, wallet custody, scanner
  frontend/      Next.js dashboard: markets, trades, agent control, wallet
  shared/        Drizzle ORM schema, shared types, migrations
  contracts/     Solidity vault + protocol adapters (Foundry)
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

### Frontend Pages

| Route        | Description                                      |
|--------------|--------------------------------------------------|
| `/dashboard` | Agent overview, recent trades, PnL               |
| `/markets`   | Live market browser with protocol links and prices|
| `/trades`    | Trade history with expandable leg details         |
| `/agent`     | Start/stop agent, configure thresholds            |
| `/wallet`    | USDT/BNB balances, deposit address, withdrawals   |

## Matching Engine

Markets across platforms use different titles for the same event. The matching engine finds equivalent pairs using a 3-pass algorithm:

1. **conditionId** — Exact hash match (same underlying CTF condition)
2. **Template extraction** — Pattern-based matching (e.g. "Will X launch a token by Y?") with entity/params normalization
3. **Composite similarity** — max(Jaccard word-level, Dice bigram) above 0.85 threshold, with a template guard to prevent false positives

Normalization handles Unicode confusables (Cyrillic/Greek lookalikes), NFKD decomposition, year stripping, and digit separator collapsing.

Production results: **102 matches** from ~2,500 markets across 3 platforms, 0 false positives.

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

## Testing

```bash
pnpm test                    # all packages
pnpm --filter agent test     # agent only (85+ tests)
pnpm --filter frontend test  # frontend only
```

Key test suites:
- `matching-engine.test.ts` — 58 tests (normalization, similarity, template extraction, regression cases)
- `discovery.test.ts` — 27 tests (pipeline, multi-platform matching)
- `executor-clob.test.ts` — Sequential execution, fill polling, partial fill handling
- `detector.test.ts` — Spread detection, fee accounting

## Tech Stack

| Layer    | Technologies                                             |
|----------|----------------------------------------------------------|
| Agent    | Node.js 22, TypeScript, viem                             |
| Platform | Hono, Drizzle ORM, PostgreSQL, Privy SDK                 |
| Frontend | Next.js 15, React 19, TanStack Query, Tailwind CSS      |
| Auth     | Privy (embedded wallets, delegated signing)              |
| Chain    | BSC mainnet (56), Gnosis CTF (ERC-1155)                  |

## License

MIT
