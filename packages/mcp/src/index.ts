import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getProfile,
  getAgentStatus,
  startAgent,
  stopAgent,
  getWallet,
  getTrades,
  getMarkets,
  updateConfig,
  getUserWallet,
  saveCredentials,
  clearCredentials,
} from "./api-client.js";

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

function getFrontendUrl() { return process.env.FRONTEND_URL || "http://localhost:3000"; }

const server = new McpServer({
  name: "prophet",
  version: "1.0.0",
});

// --- Auth Tools ---

server.registerTool("login", {
  title: "Login",
  description: "Log in to Prophet. Opens a browser window for authentication. Use this before any other tool if not logged in.",
}, async () => {
  const existing = getUserWallet();
  if (existing) {
    return { content: [{ type: "text" as const, text: `Already logged in as ${existing}. Use logout first to switch accounts.` }] };
  }

  const walletAddress = await new Promise<string>((resolve, reject) => {
    const httpServer = createServer((req, res) => {
      // CORS headers for frontend
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

      // Open browser — works on macOS, Linux, Windows
      import("node:child_process").then(({ exec }) => {
        const cmd = process.platform === "darwin" ? `open "${loginUrl}"`
          : process.platform === "win32" ? `start "${loginUrl}"`
          : `xdg-open "${loginUrl}"`;
        exec(cmd);
      });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      httpServer.close();
      reject(new Error("Login timed out — no response from browser within 2 minutes."));
    }, 120_000);
  });

  saveCredentials(walletAddress.toLowerCase());
  return { content: [{ type: "text" as const, text: `Logged in as ${walletAddress.toLowerCase()}. Credentials saved to ~/.prophet/credentials.json.` }] };
});

server.registerTool("logout", {
  title: "Logout",
  description: "Log out of Prophet. Clears saved credentials.",
}, async () => {
  clearCredentials();
  return { content: [{ type: "text" as const, text: "Logged out. Credentials cleared." }] };
});

// --- API Tools ---

server.registerTool("get_profile", {
  title: "Get Profile",
  description: "Get user profile and trading configuration",
}, async () => {
  const data = await getProfile();
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("get_status", {
  title: "Get Agent Status",
  description: "Get trading agent running state, trades count, and uptime",
}, async () => {
  const data = await getAgentStatus();
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("start_agent", {
  title: "Start Agent",
  description: "Start the trading agent",
}, async () => {
  const data = await startAgent();
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("stop_agent", {
  title: "Stop Agent",
  description: "Stop the trading agent",
}, async () => {
  const data = await stopAgent();
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("get_balance", {
  title: "Get Balance",
  description: "Get wallet address and USDT/BNB balances",
}, async () => {
  const data = await getWallet();
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("get_opportunities", {
  title: "Get Opportunities",
  description: "Get all current arbitrage opportunities with spreads",
}, async () => {
  const data = await getMarkets();
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("get_positions", {
  title: "Get Positions",
  description: "Get open and recent trades with P&L",
}, async () => {
  const data = await getTrades();
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("update_config", {
  title: "Update Config",
  description: "Update trading configuration. All fields are optional: minTradeSize, maxTradeSize, minSpreadBps, maxSpreadBps, maxTotalTrades, dailyLossLimit, maxResolutionDays.",
  inputSchema: {
    minTradeSize: z.number().optional().describe("Minimum trade size in USDT"),
    maxTradeSize: z.number().optional().describe("Maximum trade size in USDT"),
    minSpreadBps: z.number().optional().describe("Minimum spread in basis points"),
    maxSpreadBps: z.number().optional().describe("Maximum spread in basis points"),
    maxTotalTrades: z.number().optional().describe("Maximum total open trades"),
    dailyLossLimit: z.number().optional().describe("Daily loss limit in USDT"),
    maxResolutionDays: z.number().optional().describe("Maximum days until market resolution"),
  },
}, async (params) => {
  const data = await updateConfig(params);
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
