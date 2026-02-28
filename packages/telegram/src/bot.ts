import { Bot } from "grammy";
import { handleStart } from "./commands/start.js";
import { handleHelp } from "./commands/help.js";
import { handleStatus } from "./commands/status.js";
import { handleRun } from "./commands/run.js";
import { handleStop } from "./commands/stop.js";
import { handleSpreads } from "./commands/spreads.js";
import { handlePositions } from "./commands/positions.js";
import { handleConfig, handleSet } from "./commands/config.js";
import { handleBalance } from "./commands/balance.js";
import { handleLogout } from "./commands/logout.js";

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("status", handleStatus);
  bot.command("run", handleRun);
  bot.command("stop", handleStop);
  bot.command("opportunities", handleSpreads);
  bot.command("positions", handlePositions);
  bot.command("config", handleConfig);
  bot.command("set", handleSet);
  bot.command("balance", handleBalance);
  bot.command("logout", handleLogout);

  bot.on("message", async (ctx) => {
    await ctx.reply("Unknown command. Use /help to see available commands.");
  });

  return bot;
}
