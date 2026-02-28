import type { Context } from "grammy";
import { getMarkets } from "../api-client.js";
import { formatSpreads } from "../notifications/formatter.js";

export async function handleSpreads(ctx: Context): Promise<void> {
  try {
    const data = await getMarkets();
    const messages = formatSpreads(data.opportunities);
    for (const msg of messages) {
      await ctx.reply(msg, { parse_mode: "HTML" });
    }
  } catch {
    await ctx.reply("Failed to fetch market data. Try again later.");
  }
}
