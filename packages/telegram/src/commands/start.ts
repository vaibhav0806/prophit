import type { Context } from "grammy";
import { getProfile, ApiError } from "../api-client.js";

export async function handleStart(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  try {
    const profile = await getProfile(chatId);
    await ctx.reply(
      `Welcome back! Your Prophet account is linked.\n\nWallet: ${profile.walletAddress}\nAgent: ${profile.config?.agentStatus ?? "not configured"}\n\nUse /help to see available commands.`
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const linkUrl = `${frontendUrl}/link-telegram?chatId=${chatId}`;
      await ctx.reply(
        `Welcome to Prophet!\n\nLink your account to get started:\n${linkUrl}\n\nAfter linking, come back and use /help to see available commands.`
      );
    } else {
      await ctx.reply("Something went wrong. Please try again later.");
    }
  }
}
