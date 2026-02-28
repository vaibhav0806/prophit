import type { Context } from "grammy";
import { getProfile, updateConfig, ApiError } from "../api-client.js";
import { formatConfig } from "../notifications/formatter.js";

export async function handleConfig(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  try {
    const profile = await getProfile(chatId);
    await ctx.reply(formatConfig(profile), { parse_mode: "HTML" });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ctx.reply("Account not linked. Use /start to connect your Prophet account.");
    } else {
      await ctx.reply("Failed to fetch config. Try again later.");
    }
  }
}

const VALID_KEYS: Record<string, string> = {
  mintradesize: "minTradeSize",
  maxtradesize: "maxTradeSize",
  minspreadbps: "minSpreadBps",
  maxspreadbps: "maxSpreadBps",
  maxtotaltrades: "maxTotalTrades",
  dailylosslimit: "dailyLossLimit",
  maxresolutiondays: "maxResolutionDays",
};

export async function handleSet(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/).slice(1); // skip "/set"
  if (parts.length < 2) {
    const keys = Object.keys(VALID_KEYS).join(", ");
    await ctx.reply(`Usage: /set <key> <value>\n\nValid keys: ${keys}`);
    return;
  }

  const [rawKey, ...rest] = parts;
  const key = VALID_KEYS[rawKey.toLowerCase()];
  if (!key) {
    const keys = Object.keys(VALID_KEYS).join(", ");
    await ctx.reply(`Unknown key "${rawKey}".\n\nValid keys: ${keys}`);
    return;
  }

  const value = rest.join(" ");

  try {
    // Integer keys
    if (["minSpreadBps", "maxSpreadBps", "maxTotalTrades", "maxResolutionDays"].includes(key)) {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        await ctx.reply(`"${value}" is not a valid number.`);
        return;
      }
      await updateConfig(chatId, { [key]: num });
    } else {
      // String keys (trade sizes, loss limit — sent as strings for bigint)
      await updateConfig(chatId, { [key]: value });
    }
    await ctx.reply(`Updated ${rawKey} to ${value}.`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ctx.reply("Account not linked. Use /start to connect your Prophet account.");
    } else {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await ctx.reply(`Failed to update: ${msg}`);
    }
  }
}
