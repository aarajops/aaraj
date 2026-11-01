import { sql } from "drizzle-orm";
import type { AuditTransaction } from "../platform/audit/audit.types.js";

export async function lockCartOwner(
  transaction: AuditTransaction,
  kind: "customer" | "guest",
  ownerId: string,
): Promise<void> {
  const resource = JSON.stringify(["aaraj/quote-owner/v1", kind, ownerId]);
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))`,
  );
}
