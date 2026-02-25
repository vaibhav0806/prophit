ALTER TABLE "deposits" ALTER COLUMN "amount" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "user_configs" ALTER COLUMN "min_trade_size" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "user_configs" ALTER COLUMN "max_trade_size" SET DEFAULT 100;--> statement-breakpoint
ALTER TABLE "user_configs" ALTER COLUMN "daily_loss_limit" SET DEFAULT 50;--> statement-breakpoint
ALTER TABLE "withdrawals" ALTER COLUMN "amount" SET DATA TYPE numeric(78, 0);