import type { Context } from "grammy";
import { getWallet, ApiError } from "../api-client.js";
import { formatBalance } from "../notifications/formatter.js";

export async function handleBalance(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  try {
    const wallet = await getWallet(chatId);
    await ctx.reply(formatBalance(wallet), { parse_mode: "HTML" });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ctx.reply("Account not linked. Use /start to connect your Prophet account.");
    } else {
      await ctx.reply("Failed to fetch balance. Try again later.");
    }
  }
}
