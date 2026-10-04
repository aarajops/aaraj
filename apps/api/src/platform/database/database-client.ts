import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getPostgresSslOptions } from "./postgres-ssl.js";

let poolInstance: Pool | undefined;
let drizzleInstance: ReturnType<typeof drizzle> | undefined;

export function getPostgresPool(): Pool {
  if (poolInstance) return poolInstance;

  const database = process.env.POSTGRES_DB;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const host = process.env.POSTGRES_HOST ?? "127.0.0.1";
  if (!database || !user || !password) {
    throw new Error(
      "POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD must be configured before connecting to PostgreSQL.",
    );
  }
  if (process.env.NODE_ENV === "production" && !process.env.POSTGRES_HOST) {
    throw new Error("POSTGRES_HOST must be configured in production.");
  }

  poolInstance = new Pool({
    host,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database,
    user,
    password,
    ssl: getPostgresSslOptions(),
    options: "-c search_path=pg_catalog",
    max: 5,
    connectionTimeoutMillis: 5_000,
  });

  return poolInstance;
}

export function getDrizzleDatabase(): ReturnType<typeof drizzle> {
  drizzleInstance ??= drizzle(getPostgresPool());
  return drizzleInstance;
}

export async function closePostgresPool(): Promise<void> {
  await poolInstance?.end();
  poolInstance = undefined;
  drizzleInstance = undefined;
}
