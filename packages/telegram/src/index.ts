import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load root .env (two levels up from packages/telegram/)
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
import { createBot } from "./bot.js";
import { startNotificationServer } from "./notifications/server.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_SECRET = process.env.TELEGRAM_BOT_SECRET;
const NOTIFY_PORT = parseInt(process.env.TELEGRAM_NOTIFY_PORT || "4100", 10);

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

if (!BOT_SECRET) {
  console.error("TELEGRAM_BOT_SECRET is required");
  process.exit(1);
}

const bot = createBot(BOT_TOKEN);

// Start notification HTTP server
startNotificationServer(bot, NOTIFY_PORT);

// Start long polling
bot.start({
  onStart: () => console.log("[Telegram] Bot started polling"),
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[Telegram] Received ${signal}, shutting down...`);
    bot.stop();
    process.exit(0);
  });
}
