import "dotenv/config";
import { createDb } from "@prophet/shared/db";
import { tradingWallets } from "@prophet/shared/db";
import { eq } from "drizzle-orm";

const userId = "did:privy:cmm11oxdw003i0cia1qc8yul8";
const proxyAddress = "0xD2d193AbB6Ca9365C4D32E52e26a7264F30FfCF9";

const db = createDb(process.env.DATABASE_URL!);

await db.update(tradingWallets)
  .set({ safeProxyAddress: proxyAddress })
  .where(eq(tradingWallets.userId, userId));

const [row] = await db.select({ safeProxyAddress: tradingWallets.safeProxyAddress })
  .from(tradingWallets)
  .where(eq(tradingWallets.userId, userId))
  .limit(1);

console.log("Saved. DB value:", row?.safeProxyAddress);
process.exit(0);
