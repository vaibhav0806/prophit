import type { Context } from "grammy";

const HELP_TEXT = `<b>Prophet Bot Commands</b>

/start — Link your account
/status — Agent state &amp; stats
/run — Start trading agent
/stop — Stop trading agent
/opportunities — Top market opportunities
/positions — Open trades
/balance — Wallet balance
/config — View trading config
/set &lt;key&gt; &lt;value&gt; — Update config
/logout — Unlink Telegram account
/help — This message`;

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
}
