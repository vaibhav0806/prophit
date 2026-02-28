import chalk from "chalk";

export function formatStatus(data: { running: boolean; tradesExecuted: number; lastScan: number; uptime: number }) {
  const state = data.running ? chalk.green("Running") : chalk.dim("Stopped");
  const uptime = data.running ? formatUptime(data.uptime) : "—";
  const lastScan = data.lastScan ? timeAgo(data.lastScan) : "never";

  return [
    `  ${chalk.cyan("Agent:")}    ${state}`,
    `  ${chalk.cyan("Trades:")}   ${data.tradesExecuted}`,
    `  ${chalk.cyan("Uptime:")}   ${uptime}`,
    `  ${chalk.cyan("Last scan:")} ${lastScan}`,
  ].join("\n");
}

export function formatBalance(data: { address: string; usdtBalance: string; bnbBalance: string }) {
  return [
    `  ${chalk.cyan("Address:")} ${data.address}`,
    `  ${chalk.cyan("USDT:")}    ${Number(data.usdtBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `  ${chalk.cyan("BNB:")}     ${Number(data.bnbBalance).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`,
  ].join("\n");
}

export function formatOpportunities(data: { quoteCount: number; updatedAt: number; opportunities: Array<{ marketId: string; title: string | null; spreadBps: number; estProfit: string; totalCost: string }> }) {
  if (data.opportunities.length === 0) {
    return chalk.dim("  No opportunities found.");
  }

  const header = `  ${data.opportunities.length} opportunities found\n`;
  const rows = data.opportunities.map((o) => {
    const title = truncate(o.title || o.marketId, 40);
    const spread = `${o.spreadBps} bps`.padStart(8);
    const profit = `$${Number(o.estProfit).toFixed(2)} profit`;
    return `  ${title.padEnd(42)} ${chalk.green(spread)}   ${profit}`;
  });

  return header + rows.join("\n");
}

export function formatPositions(data: { trades: Array<{ id: string; marketId: string; status: string; spreadBps: number; totalCost: number; pnl: number | null; openedAt: string; marketTitle: string | null }> }) {
  if (data.trades.length === 0) {
    return chalk.dim("  No trades found.");
  }

  const rows = data.trades.map((t) => {
    const title = truncate(t.marketTitle || t.marketId, 35);
    const status = t.status === "open" ? chalk.green(t.status) : chalk.dim(t.status);
    const spread = `${t.spreadBps} bps`.padStart(8);
    const cost = `$${t.totalCost.toFixed(2)}`.padStart(10);
    const pnl = t.pnl != null ? (t.pnl >= 0 ? chalk.green(`+$${t.pnl.toFixed(2)}`) : chalk.red(`-$${Math.abs(t.pnl).toFixed(2)}`)) : chalk.dim("—");
    return `  ${title.padEnd(37)} ${status.padEnd(16)} ${spread} ${cost}  ${pnl}`;
  });

  return rows.join("\n");
}

export function formatConfig(data: { id: string; walletAddress: string; config: Record<string, unknown> | null }) {
  const lines = [
    `  ${chalk.cyan("Wallet:")} ${data.walletAddress}`,
  ];

  if (data.config && Object.keys(data.config).length > 0) {
    lines.push("");
    for (const [key, val] of Object.entries(data.config)) {
      lines.push(`  ${chalk.cyan(`${key}:`)} ${val}`);
    }
  } else {
    lines.push(chalk.dim("  No custom config set (using defaults)."));
  }

  return lines.join("\n");
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
