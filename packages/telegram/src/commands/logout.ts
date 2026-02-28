import type { Context } from "grammy";
import { ApiError } from "../api-client.js";

export async function handleLogout(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  try {
    const platformUrl = process.env.PLATFORM_URL || "http://localhost:4000";
    const botSecret = process.env.TELEGRAM_BOT_SECRET || "";

    const res = await fetch(`${platformUrl}/api/me/telegram/link`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bot ${botSecret}`,
        "X-Telegram-Chat-Id": chatId,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, body.error || `API error: ${res.status}`);
    }

    await ctx.reply("Account unlinked. Use /start to link again.");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ctx.reply("No account linked. Use /start to connect.");
    } else {
      await ctx.reply("Failed to unlink. Try again later.");
    }
  }
}
