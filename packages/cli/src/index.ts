#!/usr/bin/env node
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import chalk from "chalk";
import { getUserWallet } from "./api-client.js";
import {
  handleLogin,
  handleLogout,
  handleStatus,
  handleStart,
  handleStop,
  handleBalance,
  handleOpportunities,
  handlePositions,
  handleConfig,
  handleHelp,
  COMMAND_NAMES,
} from "./commands.js";

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

// Banner
console.log("");
console.log(chalk.cyan.bold("  PROPHET") + chalk.dim(" — Prediction Market Arbitrage"));
console.log("");

// Login state
const wallet = getUserWallet();
if (wallet) {
  console.log(`  Logged in as ${chalk.cyan(wallet)}`);
} else {
  console.log(chalk.dim("  Not logged in. Type 'login' to start."));
}
console.log(chalk.dim("  Type 'help' for commands.\n"));

// REPL
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.cyan("prophet> "),
  completer: (line: string): [string[], string] => {
    const hits = COMMAND_NAMES.filter((c) => c.startsWith(line.trim()));
    return [hits.length ? hits : COMMAND_NAMES, line];
  },
});

rl.prompt();

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }

  const [cmd, ...args] = trimmed.split(/\s+/);

  try {
    switch (cmd) {
      case "login":         await handleLogin(); break;
      case "logout":        await handleLogout(); break;
      case "status":        await handleStatus(); break;
      case "start":         await handleStart(); break;
      case "stop":          await handleStop(); break;
      case "balance":       await handleBalance(); break;
      case "opportunities": await handleOpportunities(); break;
      case "positions":     await handlePositions(); break;
      case "config":        await handleConfig(args); break;
      case "help":          handleHelp(); break;
      case "exit":
      case "quit":
        console.log(chalk.dim("  Bye!\n"));
        process.exit(0);
      default:
        console.log(chalk.red(`  Unknown command: ${cmd}. Type 'help' for commands.`));
    }
  } catch (err) {
    console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
  }

  rl.prompt();
});

rl.on("close", () => {
  console.log(chalk.dim("\n  Bye!\n"));
  process.exit(0);
});
