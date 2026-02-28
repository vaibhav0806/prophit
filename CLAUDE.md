# Prophet

Prediction market arbitrage agent trading across Predict.fun, Probable, and Opinion Labs CLOBs on BNB Chain.

## Stack

- pnpm monorepo: `packages/agent`, `packages/platform`, `packages/frontend`, `packages/shared`
- Frontend: Next.js (`:3000`)
- Platform API: Hono (`:4000`)
- Auth/wallet custody: Privy (embedded wallets, delegated signing)
- DB: PostgreSQL + Drizzle ORM

## Architecture

- 3 CLOB platforms: Predict.fun (EOA), Probable (Safe proxy), Opinion Labs (EOA)
- Sequential execution: unreliable leg first (Probable/Opinion), then reliable (Predict)
- Matching engine: 3-pass (conditionId → template → composite similarity at 0.85)
- Scanner fetches quotes every 5s, agents detect spreads in 50-400 bps band

## Build & Test

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Rules

- Never commit `.env` files or secrets
- Read code before editing — match existing patterns
- Prefer editing existing files over creating new ones
