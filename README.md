# Prophit

Autonomous AI agent that detects and executes cross-market arbitrage on BNB Chain prediction markets, capturing risk-free profit from price discrepancies across Opinion, Predict.fun, and Probable.

## Architecture

```
+-------------------+       REST/WS        +-------------------+
|                   | <------------------> |                   |
|     Frontend      |                      |      Agent        |
|   (Next.js 14)    |                      | (Node.js + AI)    |
|                   |                      |                   |
+-------------------+                      +--------+----------+
        |                                           |
        | wagmi/viem                      viem + tx signing
        |                                           |
        v                                           v
+---------------------------------------------------------------+
|                     BNB Chain (BSC)                            |
|                                                               |
|  +------------------+    +----------+    +-----------------+  |
|  |  ProphitVault    |--->| Protocol |<---| OpinionAdapter  |  |
|  |  (Capital Pool)  |    | Adapter  |    | PredictAdapter  |  |
|  |  Circuit Breakers|    | Interface|    | ProbableAdapter  |  |
|  +------------------+    +----------+    +-----------------+  |
+---------------------------------------------------------------+
```

## Key Features

- **Cross-market arbitrage detection** -- scans multiple prediction markets for price discrepancies on equivalent events
- **AI semantic event matching** -- uses OpenAI embeddings to identify when different platforms list the same real-world event under different descriptions
- **Delta-neutral execution** -- buys YES on the underpriced market and NO on the overpriced market, locking in profit regardless of outcome
- **On-chain circuit breakers** -- daily trade limits, daily loss caps, per-position size caps, and cooldown periods enforced at the contract level
- **Yield rotation** -- reallocates capital across protocols based on risk-adjusted returns using Kelly criterion sizing
- **Real-time dashboard** -- live arbitrage scanner, position tracking, P&L attribution, and agent control panel
- **Unified protocol interface** -- adapter pattern normalizes CLOB, AMM, and bonding curve markets into a single interface

## Supported Protocols

| Protocol     | Type          | Status       |
|------------- |-------------- |------------- |
| Opinion      | CLOB          | Live         |
| Predict.fun  | CLOB          | Live         |
| Probable     | AMM (zero-fee)| Live         |
| XO Market    | Bonding Curve | Coming Soon  |
| Bento        | Social/UGC    | Coming Soon  |

## Quick Start

### Docker (recommended)

```bash
docker compose up
```

This starts Anvil (local chain), deploys contracts, launches the agent, and serves the frontend at `http://localhost:3000`.

### Manual

```bash
# 1. Start local chain
anvil

# 2. Deploy contracts
cd packages/contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# 3. Start agent
cd packages/agent && cp .env.example .env && pnpm dev

# 4. Start frontend
cd packages/frontend && pnpm dev
```

## Project Structure

```
packages/
  contracts/     Solidity vault, adapters, and protocol interfaces (Foundry)
  agent/         AI arbitrage agent with market scanning and trade execution (Node.js)
  frontend/      Real-time dashboard for monitoring and controlling the agent (Next.js)
```

## How It Works

If the same binary event is priced differently across two markets, you can buy the underpriced outcome on one and the opposite outcome on the other. When the combined cost is less than $1.00, the profit is guaranteed regardless of the event outcome. For example: if "BTC > $150K by June" trades at YES = $0.55 on Predict.fun and NO = $0.38 on Opinion, the total cost is $0.93 -- yielding $0.07 guaranteed profit (7.5% ROI) no matter what happens. The agent finds these spreads automatically using semantic matching to pair equivalent events across protocols, then executes both legs atomically through the on-chain vault.

## Safety

All risk controls are enforced on-chain in `ProphitVault.sol`:

- **Per-position size cap** -- limits USDT deployed per trade (default: 500 USDT)
- **Total exposure cap** -- aggregate limit across all open positions
- **Daily trade limit** -- max trades per 24-hour rolling window
- **Daily loss limit** -- auto-pauses agent if cumulative realized losses exceed threshold
- **Cooldown period** -- minimum seconds between consecutive trades
- **Emergency pause** -- owner can freeze all activity instantly via `pause()`
- **Slippage protection** -- trades are simulated via `eth_call` before execution; aborted if slippage exceeds tolerance

## Tech Stack

| Layer      | Technologies                                                         |
|----------- |--------------------------------------------------------------------- |
| Contracts  | Solidity 0.8.24, Foundry, OpenZeppelin 5.x (Ownable2Step, Pausable, ReentrancyGuard) |
| Agent      | Node.js 20, TypeScript, viem, Hono, OpenAI SDK                      |
| Frontend   | Next.js 14, React 18, wagmi v2, TanStack Query, Tailwind CSS        |

## Testing

213 tests across the stack:

- **120 contract tests** (Foundry) -- vault logic, all three protocol adapters, circuit breakers, fuzz tests
- **82 agent tests** (Vitest) -- arbitrage detection, event matching, yield rotation, persistence, retries
- **11 frontend tests** (Vitest + Testing Library) -- components, hooks, error boundaries

CI runs on every push and PR via GitHub Actions: contract build/test, agent typecheck/test, frontend build.

## Configuration

Copy `.env.example` and fill in your values:

```bash
cp packages/agent/.env.example packages/agent/.env
```

Key environment variables:

| Variable                | Description                              |
|------------------------ |----------------------------------------- |
| `RPC_URL`               | BNB Chain RPC endpoint                   |
| `PRIVATE_KEY`           | Agent wallet private key                 |
| `VAULT_ADDRESS`         | Deployed ProphitVault contract address   |
| `OPENAI_API_KEY`        | OpenAI key for semantic event matching   |
| `MIN_SPREAD_BPS`        | Minimum spread to trigger a trade (bps)  |
| `MAX_POSITION_SIZE`     | Max USDT per position (6 decimals)       |
| `SCAN_INTERVAL_MS`      | Milliseconds between market scans        |
| `OPINION_API_KEY`       | Opinion protocol API key                 |
| `PREDICT_API_KEY`       | Predict.fun API key                      |

## License

MIT
