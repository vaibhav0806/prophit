import { Hono } from "hono";
import { verifyPrivyToken } from "../../auth/privy.js";
import type { Database } from "@prophet/shared/db";
import { users } from "@prophet/shared/db";
import { eq } from "drizzle-orm";

export function createAuthRoutes(db: Database): Hono {
  const app = new Hono();

  // GET /api/auth/me - Verify Privy token and find-or-create user
  app.get("/me", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);
    try {
      const { userId, walletAddress } = await verifyPrivyToken(token);

      // Find or create user
      let [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        [user] = await db
          .insert(users)
          .values({
            id: userId,
            walletAddress,
          })
          .returning();
      } else {
        // Update last login
        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, user.id));
      }

      return c.json({ userId: user.id, address: user.walletAddress });
    } catch (err) {
      return c.json({ error: "Verification failed: " + String(err) }, 401);
    }
  });

  // POST /api/auth/logout - No-op (client discards token)
  app.post("/logout", (c) => {
    return c.json({ ok: true });
  });

  return app;
}
