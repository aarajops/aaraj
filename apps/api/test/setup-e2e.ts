import { loadLocalEnvironment } from "../src/platform/config/local-environment.js";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Redis } from "ioredis";
import { afterAll } from "vitest";
import { closePostgresPool } from "../src/platform/database/database-client.js";
import { closeRedisClient } from "../src/platform/redis/redis-client.js";

process.env.NODE_ENV = "test";
loadLocalEnvironment();
process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_SECRET =
  "test-only-better-auth-secret-with-32-bytes-minimum";
process.env.BETTER_AUTH_URL = "http://localhost:3001";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.POSTGRES_DB ??= "aaraj_test";
process.env.POSTGRES_USER ??= "aaraj_test";
process.env.POSTGRES_PASSWORD ??= "aaraj_test";
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
redisUrl.pathname = "/15";
process.env.REDIS_URL = redisUrl.toString();
const testId = randomUUID().replaceAll("-", "");
const prefix = `better-auth:e2e-${testId}:`;
process.env.BETTER_AUTH_REDIS_KEY_PREFIX = prefix;

// Each test file owns a disposable database. Never migrate or truncate the developer's DB.
const adminHost =
  process.env.E2E_POSTGRES_HOST ?? process.env.POSTGRES_HOST ?? "127.0.0.1";
if (!isLoopbackHost(adminHost)) {
  throw new Error(
    "E2E PostgreSQL must use a literal loopback host; remote databases are not allowed.",
  );
}
const adminPort = Number(
  process.env.E2E_POSTGRES_PORT ?? process.env.POSTGRES_PORT ?? 5432,
);
if (!Number.isInteger(adminPort) || adminPort < 1 || adminPort > 65535) {
  throw new Error("E2E PostgreSQL port must be a valid TCP port.");
}
const connection = {
  host: adminHost,
  port: adminPort,
  user: process.env.E2E_POSTGRES_ADMIN_USER ?? process.env.POSTGRES_USER,
  password:
    process.env.E2E_POSTGRES_ADMIN_PASSWORD ?? process.env.POSTGRES_PASSWORD,
};
const admin = new Pool({
  ...connection,
  database: process.env.E2E_POSTGRES_ADMIN_DATABASE ?? "postgres",
});
const testDatabase = `aaraj_e2e_${testId}`;
await admin.query(`CREATE DATABASE ${quoteIdentifier(testDatabase)}`);
process.env.POSTGRES_DB = testDatabase;
process.env.POSTGRES_HOST = adminHost;
process.env.POSTGRES_PORT = String(adminPort);
process.env.POSTGRES_USER = connection.user;
process.env.POSTGRES_PASSWORD = connection.password;
const migrationPool = new Pool({ ...connection, database: testDatabase });
try {
  await migrate(drizzle(migrationPool), { migrationsFolder: "./drizzle" });
} catch (error) {
  await migrationPool.end();
  await admin.query(
    `DROP DATABASE ${quoteIdentifier(testDatabase)} WITH (FORCE)`,
  );
  await admin.end();
  throw error;
}
await migrationPool.end();

afterAll(async () => {
  await closePostgresPool();
  await closeRedisClient();
  const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
    try {
      await admin.query(
        `DROP DATABASE ${quoteIdentifier(testDatabase)} WITH (FORCE)`,
      );
    } finally {
      await admin.end();
    }
  }
});

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    (isIP(normalized) === 4 && Number(normalized.split(".")[0]) === 127)
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
