import type { Context, Next } from "hono";
import type { Database } from "@prophet/shared/db";
import { users } from "@prophet/shared/db";
import { eq } from "drizzle-orm";
import { verifyPrivyToken } from "./privy.js";

export interface AuthContext {
  userId: string;
  walletAddress: string;
}

export function createAuthMiddleware(db: Database) {
  return async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    // Bot auth: Authorization: Bot <secret> + X-Telegram-Chat-Id
    if (authHeader.startsWith("Bot ")) {
      const secret = authHeader.slice(4);
      const botSecret = process.env.TELEGRAM_BOT_SECRET;
      if (!botSecret || secret !== botSecret) {
        return c.json({ error: "Invalid bot secret" }, 401);
      }

      const chatId = c.req.header("X-Telegram-Chat-Id");
      if (chatId) {
        const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId)).limit(1);
        if (!user) return c.json({ error: "Telegram account not linked" }, 401);
        c.set("userId", user.id);
        c.set("walletAddress", user.walletAddress);
        return next();
      }

      const wallet = c.req.header("X-User-Wallet");
      if (wallet) {
        const [user] = await db.select().from(users).where(eq(users.walletAddress, wallet.toLowerCase())).limit(1);
        if (!user) return c.json({ error: "User not found" }, 401);
        c.set("userId", user.id);
        c.set("walletAddress", user.walletAddress);
        return next();
      }

      return c.json({ error: "Missing X-Telegram-Chat-Id or X-User-Wallet header" }, 401);
    }

    // Bearer auth: existing Privy verification
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const session = await verifyPrivyToken(token);
        c.set("userId", session.userId);
        c.set("walletAddress", session.walletAddress);
        return next();
      } catch {
        return c.json({ error: "Invalid or expired session" }, 401);
      }
    }

    return c.json({ error: "Invalid Authorization header" }, 401);
  };
}
