import type { Context } from "grammy";
import { startAgent, ApiError } from "../api-client.js";

export async function handleRun(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  try {
    await startAgent(chatId);
    await ctx.reply("Agent started. Use /status to check progress.");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ctx.reply("Account not linked. Use /start to connect your Prophet account.");
    } else if (err instanceof ApiError && err.status === 409) {
      await ctx.reply("Agent is already running.");
    } else {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await ctx.reply(`Failed to start agent: ${msg}`);
    }
  }
}
