import type { Context } from "grammy";
import { stopAgent, ApiError } from "../api-client.js";

export async function handleStop(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  try {
    await stopAgent(chatId);
    await ctx.reply("Agent stopped.");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ctx.reply("Account not linked. Use /start to connect your Prophet account.");
    } else {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await ctx.reply(`Failed to stop agent: ${msg}`);
    }
  }
}
