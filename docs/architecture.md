# System Architecture

## High-Level Overview

Prophet is a prediction market arbitrage platform that detects and executes cross-platform spread opportunities across three BNB Chain CLOBs: **Predict.fun**, **Probable**, and **Opinion Labs**.

```mermaid
graph TB
    subgraph Clients["Client Interfaces"]
        FE["Frontend<br/>(Next.js :3000)"]
        TG["Telegram Bot<br/>(Grammy)"]
        MCP["MCP Server<br/>(Claude Integration)"]
    end

    subgraph Platform["Platform API (Hono :4000)"]
        API["REST API"]
        AUTH["Auth Middleware<br/>(Privy JWT / Bot Secret)"]
        AM["Agent Manager"]
        SC["Scanner Service"]
        QS["QuoteStore<br/>(in-memory)"]
        DW["Deposit Watcher"]
        WP["Withdrawal Processor"]
    end

    subgraph Agents["Per-User Agent"]
        AI["Agent Instance"]
        EX["Executor"]
        ARB["Arb Detector"]
    end

    subgraph CLOBs["BNB Chain CLOBs"]
        PR["Predict.fun<br/>(EOA)"]
        PB["Probable<br/>(Safe Proxy)"]
        OP["Opinion Labs<br/>(EOA)"]
    end

    subgraph Infra["Infrastructure"]
        DB[("PostgreSQL<br/>(NeonDB)")]
        PV["Privy<br/>(Wallets + Auth)"]
        RPC["BNB Chain RPC<br/>(Alchemy)"]
    end

    FE -->|"HTTPS"| API
    TG -->|"Bot Secret + ChatId"| API
    MCP -->|"Bot Secret + Wallet"| API

    API --> AUTH
    AUTH --> PV
    API --> AM
    API --> SC
    API --> QS
    API --> DW
    API --> WP

    AM -->|"1 per user"| AI
    AI --> EX
    AI --> ARB
    AI --> QS

    ARB -->|"getLatestQuotes()"| QS
    SC -->|"update every 5s"| QS

    SC -->|"fetch markets"| PR
    SC -->|"fetch markets"| PB
    SC -->|"fetch markets"| OP

    EX -->|"place orders"| PR
    EX -->|"place orders"| PB
    EX -->|"place orders"| OP

    AM --> DB
    DW --> DB
    WP --> DB
    API --> DB

    WP --> PV
    DW --> RPC
    EX --> RPC
    AI --> PV
```

## Component Details

### Scanner Service

Runs on platform startup. Responsible for market discovery and continuous quote fetching.

```mermaid
flowchart LR
    subgraph Discovery["Discovery (once at startup ~60s)"]
        D1[Fetch Predict markets] --> M[Matching Engine]
        D2[Fetch Probable markets] --> M
        D3[Fetch Opinion markets] --> M
        M --> P1["Pass 1: conditionId match"]
        P1 --> P2["Pass 2: Template match"]
        P2 --> P3["Pass 3: Composite similarity >= 0.85"]
        P3 --> MM["Market Maps<br/>(shared keys)"]
    end

    subgraph Scanning["Quote Scanning (every 5s)"]
        S1[PredictProvider] --> QS["QuoteStore"]
        S2[ProbableProvider] --> QS
        S3[OpinionProvider] --> QS
    end

    MM --> S1
    MM --> S2
    MM --> S3
```

### Matching Engine (3-Pass)

Cross-platform market matching with increasing fuzziness per pass.

```mermaid
flowchart TD
    A["All markets from 3 platforms"] --> B["Pass 1: Exact conditionId"]
    B --> C{Match?}
    C -->|Yes| D["Matched — highest confidence"]
    C -->|No| E["Pass 2: Template extraction"]
    E --> F["normalizeTitle → extractTemplate"]
    F --> G{Same template + entity + params?}
    G -->|Yes| H["Matched — template match"]
    G -->|No| I["Pass 3: Fuzzy similarity"]
    I --> J["compositeSimilarity = max(Jaccard, Dice)"]
    J --> K{"Score >= 0.85?"}
    K -->|Yes| L{Template guard?}
    L -->|"Same template name, different entity"| M["Rejected — false positive guard"]
    L -->|Otherwise| N["Matched — fuzzy"]
    K -->|No| O["Unmatched"]
```

### Auth Flow

Three authentication paths converge into a unified user context.

```mermaid
flowchart TD
    subgraph Web["Web App Auth"]
        W1["Privy login modal"] --> W2["Bearer JWT token"]
        W2 --> W3["Verify via Privy SDK"]
        W3 --> W4["Find/create user by privyUserId"]
    end

    subgraph Bot["Telegram Bot Auth"]
        B1["Bot <secret>"] --> B2["Validate shared secret"]
        B2 --> B3["X-Telegram-Chat-Id header"]
        B3 --> B4["Lookup user by telegramChatId"]
    end

    subgraph MCPAuth["MCP Server Auth"]
        M1["Bot <secret>"] --> M2["Validate shared secret"]
        M2 --> M3["X-User-Wallet header"]
        M3 --> M4["Lookup user by walletAddress"]
    end

    W4 --> U["Unified user context<br/>{ userId, walletAddress }"]
    B4 --> U
    M4 --> U
    U --> API["Authorized API access"]
```

### Wallet & Fund Flow

Privy-custodied embedded wallets with on-chain deposits and withdrawals on BNB Chain.

```mermaid
flowchart LR
    subgraph Deposit["Deposit"]
        D1["User sends USDT/BNB"] --> D2["Privy embedded wallet address"]
        D2 --> D3["DepositWatcher polls every 30s"]
        D3 --> D4["Detect balance delta"]
        D4 --> D5["Record deposit in DB"]
    end

    subgraph Trading["Trading"]
        T1["Agent uses wallet for CLOB orders"]
        T2["Predict: direct EOA signing via Privy"]
        T3["Probable: via Gnosis Safe proxy"]
        T4["Opinion: direct EOA signing via Privy"]
        T1 --> T2
        T1 --> T3
        T1 --> T4
    end

    subgraph Withdrawal["Withdrawal"]
        W1["User requests withdrawal"] --> W2["Validate balance + $1000/day limit"]
        W2 --> W3["WithdrawalProcessor"]
        W3 --> W4["Privy server SDK signs tx"]
        W4 --> W5["ERC-20 transfer on BSC"]
    end
```

### Database Schema

```mermaid
erDiagram
    users {
        text id PK "Privy userId"
        text walletAddress UK
        text telegramChatId UK
        timestamp createdAt
        timestamp lastLoginAt
    }

    tradingWallets {
        serial id PK
        text userId FK
        text address UK "Privy embedded EOA"
        text privyWalletId
        text safeProxyAddress "Gnosis Safe for Probable"
    }

    userConfigs {
        serial id PK
        text userId FK UK
        numeric minTradeSize "default $5"
        numeric maxTradeSize "default $100"
        integer minSpreadBps "default 100"
        integer maxSpreadBps "default 400"
        integer maxTotalTrades
        integer tradingDurationMs
        numeric dailyLossLimit "default $50"
        integer maxResolutionDays
        text agentStatus "stopped|running|error"
        timestamp tradingStartedAt
    }

    deposits {
        serial id PK
        text userId FK
        text txHash UK
        text token
        numeric amount
        timestamp confirmedAt
    }

    withdrawals {
        serial id PK
        text userId FK
        text toAddress
        text token
        numeric amount
        text status "pending|processing|confirmed|failed"
        text txHash
        timestamp createdAt
    }

    trades {
        serial id PK
        text userId FK
        text marketId
        text status "OPEN|PARTIAL|FILLED|CLOSED"
        jsonb legA
        jsonb legB
        integer totalCost "cents"
        integer expectedPayout "cents"
        integer spreadBps
        integer pnl "cents"
        timestamp openedAt
        timestamp closedAt
    }

    users ||--o| tradingWallets : has
    users ||--o| userConfigs : has
    users ||--o{ deposits : receives
    users ||--o{ withdrawals : requests
    users ||--o{ trades : executes
```

## Deployment Architecture

```mermaid
graph TB
    subgraph Railway["Railway Cloud"]
        FE["Frontend<br/>Next.js standalone<br/>prophet.up.railway.app"]
        PL["Platform<br/>Hono API<br/>platform-production-7443.up.railway.app"]
        TG["Telegram Bot<br/>Grammy long-polling<br/>internal :4100"]
    end

    subgraph External["External Services"]
        DB[("NeonDB<br/>PostgreSQL")]
        PV["Privy<br/>Auth + Wallets"]
        AL["Alchemy<br/>BNB RPC"]
        PRD["Predict.fun API"]
        PRB["Probable API"]
        OPN["Opinion API"]
        TGA["Telegram API"]
    end

    FE -->|"HTTPS"| PL
    TG -->|"railway.internal:4100"| PL
    PL --> DB
    PL --> PV
    PL --> AL
    PL --> PRD
    PL --> PRB
    PL --> OPN
    TG --> TGA
    FE --> PV
```

## Tech Stack Summary

| Component | Technology | Port |
|---|---|---|
| Frontend | Next.js 14, React, TailwindCSS, Privy SDK | 3000 |
| Platform API | Hono, Node.js | 4000 |
| Telegram Bot | Grammy, Node.js | 4100 (notifications) |
| MCP Server | @modelcontextprotocol/sdk, stdio | local |
| Database | PostgreSQL (NeonDB) + Drizzle ORM | — |
| Auth | Privy (JWT + embedded wallets) | — |
| Chain | BNB Chain (chainId 56) | — |
| RPC | Alchemy | — |
| Deployment | Railway (Docker) | — |
