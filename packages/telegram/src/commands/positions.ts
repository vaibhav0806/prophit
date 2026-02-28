import type { Context } from "grammy";
import { getTrades, ApiError } from "../api-client.js";
import { formatPositions } from "../notifications/formatter.js";

export async function handlePositions(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  try {
    const data = await getTrades(chatId);
    await ctx.reply(formatPositions(data.trades), { parse_mode: "HTML" });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ctx.reply("Account not linked. Use /start to connect your Prophet account.");
    } else {
      await ctx.reply("Failed to fetch positions. Try again later.");
    }
  }
}
