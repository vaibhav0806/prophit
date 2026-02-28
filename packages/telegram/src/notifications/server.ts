import { createServer } from "node:http";
import type { Bot } from "grammy";
import { formatTrade, formatWelcome } from "./formatter.js";
import { getProfile, getWallet } from "../api-client.js";

function getBotSecret() { return process.env.TELEGRAM_BOT_SECRET || ""; }

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

function verifyAuth(req: import("node:http").IncomingMessage): boolean {
  return req.headers.authorization === `Bot ${getBotSecret()}`;
}

export function startNotificationServer(bot: Bot, port: number): void {
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/notify") {
      if (!verifyAuth(req)) { res.writeHead(401); res.end("Unauthorized"); return; }

      try {
        const data = JSON.parse(await readBody(req)) as {
          chatId: string;
          event: string;
          trade?: { id: string; marketId: string; spreadBps: number; totalCost: number; status: string };
        };

        if (data.event === "trade_executed" && data.trade) {
          const message = formatTrade(data.trade);
          await bot.api.sendMessage(data.chatId, message, { parse_mode: "HTML" });
        }

        res.writeHead(200);
        res.end("OK");
      } catch (err) {
        console.error("[Notify] Failed to process notification:", err);
        res.writeHead(400);
        res.end("Bad request");
      }
      return;
    }

    if (req.method === "POST" && req.url === "/linked") {
      if (!verifyAuth(req)) { res.writeHead(401); res.end("Unauthorized"); return; }

      try {
        const data = JSON.parse(await readBody(req)) as { chatId: string };
        res.writeHead(200);
        res.end("OK");

        // Fetch user details and send welcome (fire-and-forget)
        const [profile, wallet] = await Promise.all([
          getProfile(data.chatId).catch(() => null),
          getWallet(data.chatId).catch(() => null),
        ]);

        const message = formatWelcome(profile, wallet);
        await bot.api.sendMessage(data.chatId, message, { parse_mode: "HTML" });
      } catch (err) {
        console.error("[Notify] Failed to send welcome:", err);
        if (!res.headersSent) { res.writeHead(400); res.end("Bad request"); }
      }
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end("OK");
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`[Telegram] Notification server listening on :${port}`);
  });
}
