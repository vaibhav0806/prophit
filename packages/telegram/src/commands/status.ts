import type { Context } from "grammy";
import { getAgentStatus, ApiError } from "../api-client.js";
import { formatStatus } from "../notifications/formatter.js";

export async function handleStatus(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  try {
    const status = await getAgentStatus(chatId);
    await ctx.reply(formatStatus(status), { parse_mode: "HTML" });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ctx.reply("Account not linked. Use /start to connect your Prophet account.");
    } else {
      await ctx.reply("Failed to fetch status. Try again later.");
    }
  }
}
