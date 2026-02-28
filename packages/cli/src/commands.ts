import { createServer } from "node:http";
import {
  getUserWallet,
  saveCredentials,
  clearCredentials,
  getAgentStatus,
  startAgent,
  stopAgent,
  getWallet,
  getMarkets,
  getTrades,
  getProfile,
  updateConfig,
} from "./api-client.js";
import {
  formatStatus,
  formatBalance,
  formatOpportunities,
  formatPositions,
  formatConfig,
} from "./formatter.js";
import chalk from "chalk";

function getFrontendUrl() { return process.env.FRONTEND_URL || "http://localhost:3000"; }

export async function handleLogin(): Promise<void> {
  const existing = getUserWallet();
  if (existing) {
    console.log(chalk.yellow(`  Already logged in as ${existing}. Use 'logout' first to switch accounts.`));
    return;
  }

  console.log(chalk.dim("  Opening browser for authentication..."));

  const walletAddress = await new Promise<string>((resolve, reject) => {
    const httpServer = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          try {
            const { walletAddress } = JSON.parse(body);
            if (!walletAddress) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing walletAddress" }));
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            httpServer.close();
            resolve(walletAddress);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start callback server"));
        return;
      }
      const port = addr.port;
      const loginUrl = `${getFrontendUrl()}/mcp-link?port=${port}`;

      import("node:child_process").then(({ exec }) => {
        const cmd = process.platform === "darwin" ? `open "${loginUrl}"`
          : process.platform === "win32" ? `start "${loginUrl}"`
          : `xdg-open "${loginUrl}"`;
        exec(cmd);
      });
    });

    setTimeout(() => {
      httpServer.close();
      reject(new Error("Login timed out — no response from browser within 2 minutes."));
    }, 120_000);
  });

  saveCredentials(walletAddress.toLowerCase());
  console.log(chalk.green(`  Logged in as ${walletAddress.toLowerCase()}`));
}

export async function handleLogout(): Promise<void> {
  clearCredentials();
  console.log(chalk.green("  Logged out. Credentials cleared."));
}

export async function handleStatus(): Promise<void> {
  const data = await getAgentStatus();
  console.log(formatStatus(data));
}

export async function handleStart(): Promise<void> {
  await startAgent();
  console.log(chalk.green("  Agent started."));
}

export async function handleStop(): Promise<void> {
  await stopAgent();
  console.log(chalk.green("  Agent stopped."));
}

export async function handleBalance(): Promise<void> {
  const data = await getWallet();
  console.log(formatBalance(data));
}

export async function handleOpportunities(): Promise<void> {
  const data = await getMarkets();
  console.log(formatOpportunities(data));
}

export async function handlePositions(): Promise<void> {
  const data = await getTrades();
  console.log(formatPositions(data));
}

export async function handleConfig(args: string[]): Promise<void> {
  if (args[0] === "set" && args.length >= 3) {
    const key = args[1];
    const raw = args.slice(2).join(" ");
    const value = isNaN(Number(raw)) ? raw : Number(raw);
    await updateConfig({ [key]: value });
    console.log(chalk.green(`  Updated ${key} → ${value}`));
    return;
  }

  const data = await getProfile();
  console.log(formatConfig(data));
}

export function handleHelp(): void {
  const commands = [
    ["login",                "Authenticate via browser"],
    ["logout",               "Clear saved credentials"],
    ["status",               "Agent state, trades, uptime"],
    ["start",                "Start the trading agent"],
    ["stop",                 "Stop the trading agent"],
    ["balance",              "Wallet USDT/BNB balances"],
    ["opportunities",        "Current arb opportunities"],
    ["positions",            "Open trades with P&L"],
    ["config",               "View current config"],
    ["config set <key> <val>", "Update a config value"],
    ["help",                 "Show this help"],
    ["exit",                 "Exit the CLI"],
  ];

  console.log("");
  for (const [cmd, desc] of commands) {
    console.log(`  ${chalk.cyan(cmd.padEnd(24))} ${desc}`);
  }
  console.log("");
}

export const COMMAND_NAMES = [
  "login", "logout", "status", "start", "stop",
  "balance", "opportunities", "positions", "config", "help", "exit", "quit",
];
