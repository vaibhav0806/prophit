export function formatWelcome(
  profile: { id: string; walletAddress: string; config: Record<string, unknown> | null } | null,
  wallet: { address: string; usdtBalance: string; bnbBalance: string } | null,
): string {
  const lines = [`<b>Account Linked!</b>`, ``];

  if (profile) {
    lines.push(`Wallet: <code>${escapeHtml(profile.walletAddress)}</code>`);
  }
  if (wallet) {
    lines.push(`USDT: <b>${wallet.usdtBalance}</b>`);
    lines.push(`BNB: <b>${wallet.bnbBalance}</b>`);
  }
  if (profile?.config) {
    lines.push(``);
    lines.push(`Agent: ${profile.config.agentStatus}`);
    lines.push(`Spread: ${profile.config.minSpreadBps}–${profile.config.maxSpreadBps} bps`);
  }

  lines.push(``);
  lines.push(`Use /help to see available commands.`);

  return lines.join("\n");
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatTrade(trade: { id: string; marketId: string; spreadBps: number; totalCost: number; status: string }): string {
  const cost = (trade.totalCost / 100).toFixed(2); // stored as cents
  return [
    `<b>Trade Executed</b>`,
    ``,
    `ID: <code>${escapeHtml(trade.id.slice(0, 8))}</code>`,
    `Market: <code>${escapeHtml(trade.marketId.slice(0, 12))}</code>`,
    `Spread: <b>${trade.spreadBps} bps</b>`,
    `Cost: <b>$${cost}</b>`,
    `Status: ${escapeHtml(trade.status)}`,
  ].join("\n");
}

export function formatStatus(data: { running: boolean; tradesExecuted: number; uptime: number }): string {
  const uptimeMin = Math.floor(data.uptime / 60000);
  const hours = Math.floor(uptimeMin / 60);
  const mins = uptimeMin % 60;
  const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return [
    `<b>Agent Status</b>`,
    ``,
    `State: ${data.running ? "Running" : "Stopped"}`,
    `Trades: ${data.tradesExecuted}`,
    data.running ? `Uptime: ${uptimeStr}` : "",
  ].filter(Boolean).join("\n");
}

export function formatBalance(wallet: { address: string; usdtBalance: string; bnbBalance: string }): string {
  return [
    `<b>Wallet Balance</b>`,
    ``,
    `Address: <code>${escapeHtml(wallet.address)}</code>`,
    `USDT: <b>${wallet.usdtBalance}</b>`,
    `BNB: <b>${wallet.bnbBalance}</b>`,
  ].join("\n");
}

function formatUsdt18(raw: string): string {
  const n = Number(raw) / 1e18;
  return n < 0.01 ? n.toFixed(4) : n.toFixed(2);
}

function formatUsdt6(raw: string): string {
  const n = Number(raw) / 1e6;
  return n < 0.01 ? n.toFixed(4) : n.toFixed(2);
}

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

export function formatSpreads(opportunities: Array<{ title: string | null; spreadBps: number; estProfit: string; totalCost: string }>): string[] {
  if (opportunities.length === 0) return ["No opportunities found."];

  const header = `<b>Opportunities (${opportunities.length})</b>\n`;
  const messages: string[] = [];
  let current = header;

  for (let i = 0; i < opportunities.length; i++) {
    const o = opportunities[i];
    const title = o.title ? escapeHtml(o.title) : "Unknown";
    const cost = formatUsdt18(o.totalCost);
    const profit = formatUsdt6(o.estProfit);
    const pct = bpsToPercent(o.spreadBps);
    const line = `\n${i + 1}. ${title}\n   <b>${o.spreadBps} bps (${pct}%)</b> | +$${profit} | Cost: $${cost}`;

    if (current.length + line.length > 4000) {
      messages.push(current);
      current = `<b>Opportunities (cont.)</b>\n`;
    }
    current += line;
  }
  if (current.length > 0) messages.push(current);

  return messages;
}

export function formatPositions(trades: Array<{ id: string; marketId: string; status: string; spreadBps: number; totalCost: number; pnl: number | null; marketTitle: string | null }>): string {
  if (trades.length === 0) return "No open positions.";

  const lines = trades.slice(0, 10).map((t) => {
    const title = t.marketTitle ? escapeHtml(t.marketTitle.slice(0, 35)) : t.marketId.slice(0, 12);
    const cost = (t.totalCost / 100).toFixed(2);
    const pnl = t.pnl != null ? `$${(t.pnl / 100).toFixed(2)}` : "pending";
    return `${escapeHtml(t.status)} | ${title}\n   ${t.spreadBps}bps | $${cost} | P&L: ${pnl}`;
  });

  return [`<b>Positions</b>`, ``, ...lines].join("\n");
}

export function formatConfig(profile: { config: Record<string, unknown> | null }): string {
  if (!profile.config) return "No config set. Use the dashboard to configure.";

  const c = profile.config;
  return [
    `<b>Trading Config</b>`,
    ``,
    `Trade Size: $${c.minTradeSize} - $${c.maxTradeSize}`,
    `Spread: ${c.minSpreadBps} - ${c.maxSpreadBps} bps`,
    `Max Trades: ${c.maxTotalTrades ?? "unlimited"}`,
    `Daily Loss Limit: $${c.dailyLossLimit}`,
    `Max Resolution: ${c.maxResolutionDays ? `${c.maxResolutionDays} days` : "any"}`,
    `Status: ${c.agentStatus}`,
  ].join("\n");
}
