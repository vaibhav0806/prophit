import { pgTable, text, timestamp, integer, bigint, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Use nanoid-style IDs (text) not auto-increment. Generate with crypto.randomUUID().

export const users = pgTable("users", {
  id: text("id").primaryKey(), // crypto.randomUUID()
  walletAddress: text("wallet_address").notNull().unique(),
  telegramChatId: text("telegram_chat_id").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at"),
});

export const tradingWallets = pgTable("trading_wallets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  address: text("address").notNull().unique(),
  privyWalletId: text("privy_wallet_id").notNull(),
  safeProxyAddress: text("safe_proxy_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userConfigs = pgTable("user_configs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id).unique(),
  minTradeSize: bigint("min_trade_size", { mode: "bigint" }).notNull().default(sql`5`), // $5 USDT
  maxTradeSize: bigint("max_trade_size", { mode: "bigint" }).notNull().default(sql`100`), // $100 USDT
  minSpreadBps: integer("min_spread_bps").notNull().default(100),
  maxSpreadBps: integer("max_spread_bps").notNull().default(400),
  maxTotalTrades: integer("max_total_trades"), // null = unlimited
  tradingDurationMs: bigint("trading_duration_ms", { mode: "bigint" }), // null = unlimited
  tradingStartedAt: timestamp("trading_started_at"),
  dailyLossLimit: bigint("daily_loss_limit", { mode: "bigint" }).notNull().default(sql`50`), // $50 USDT — safety circuit breaker for execution failures
  maxResolutionDays: integer("max_resolution_days"), // null = any
  agentStatus: text("agent_status").notNull().default("stopped"), // stopped | running | error
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const deposits = pgTable("deposits", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  txHash: text("tx_hash").notNull().unique(),
  token: text("token").notNull(), // "USDT" | "BNB"
  amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
  confirmedAt: timestamp("confirmed_at").defaultNow().notNull(),
});

export const withdrawals = pgTable("withdrawals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  toAddress: text("to_address").notNull(),
  token: text("token").notNull(),
  amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("pending"), // pending | processing | confirmed | failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

export const trades = pgTable("trades", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  marketId: text("market_id").notNull(),
  status: text("status").notNull(), // OPEN | PARTIAL | FILLED | CLOSED | EXPIRED
  legA: jsonb("leg_a").notNull(),
  legB: jsonb("leg_b").notNull(),
  totalCost: bigint("total_cost", { mode: "number" }).notNull(),
  expectedPayout: bigint("expected_payout", { mode: "number" }).notNull(),
  spreadBps: integer("spread_bps").notNull(),
  pnl: bigint("pnl", { mode: "number" }),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
}, (table) => [
  index("trades_user_id_idx").on(table.userId),
  index("trades_market_id_idx").on(table.marketId),
]);

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  conditionId: text("condition_id").notNull(),
  title: text("title").notNull(),
  category: text("category"),
  probableMarketId: text("probable_market_id"),
  predictMarketId: text("predict_market_id"),
  resolvesAt: timestamp("resolves_at"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
}, (table) => [
  index("markets_condition_id_idx").on(table.conditionId),
]);

// Relations

export const usersRelations = relations(users, ({ one, many }) => ({
  tradingWallet: one(tradingWallets, { fields: [users.id], references: [tradingWallets.userId] }),
  config: one(userConfigs, { fields: [users.id], references: [userConfigs.userId] }),
  deposits: many(deposits),
  withdrawals: many(withdrawals),
  trades: many(trades),
}));

export const tradingWalletsRelations = relations(tradingWallets, ({ one }) => ({
  user: one(users, { fields: [tradingWallets.userId], references: [users.id] }),
}));

export const depositsRelations = relations(deposits, ({ one }) => ({
  user: one(users, { fields: [deposits.userId], references: [users.id] }),
}));

export const withdrawalsRelations = relations(withdrawals, ({ one }) => ({
  user: one(users, { fields: [withdrawals.userId], references: [users.id] }),
}));

export const tradesRelations = relations(trades, ({ one }) => ({
  user: one(users, { fields: [trades.userId], references: [users.id] }),
}));
