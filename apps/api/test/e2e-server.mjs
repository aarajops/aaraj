import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Redis } from "ioredis";
import { Pool } from "pg";

process.env.NODE_ENV = "test";
const localEnv = fileURLToPath(
  new URL("../../../infrastructure/local/.env.local", import.meta.url),
);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
process.env.NODE_ENV = "test";

const host =
  process.env.E2E_POSTGRES_HOST ?? process.env.POSTGRES_HOST ?? "127.0.0.1";
if (!isLoopbackHost(host)) {
  throw new Error("E2E PostgreSQL must use a literal loopback host.");
}
const port = Number(
  process.env.E2E_POSTGRES_PORT ?? process.env.POSTGRES_PORT ?? 5432,
);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("E2E PostgreSQL port must be a valid TCP port.");
}
const adminUser =
  process.env.E2E_POSTGRES_ADMIN_USER ??
  process.env.POSTGRES_USER ??
  "aaraj_test";
const adminPassword =
  process.env.E2E_POSTGRES_ADMIN_PASSWORD ??
  process.env.POSTGRES_PASSWORD ??
  "aaraj_test";
const adminDatabase = process.env.E2E_POSTGRES_ADMIN_DATABASE ?? "postgres";
const testId = randomUUID().replaceAll("-", "");
const database = `aaraj_it_${testId}`;
const migrationRole = `aaraj_mig_${testId}`;
const runtimeRole = `aaraj_app_${testId}`;
const migrationPassword = randomUUID() + randomUUID();
const runtimePassword = randomUUID() + randomUUID();
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
redisUrl.pathname = "/15";
const redisPrefix = `better-auth:integration-${testId}:`;
const admin = new Pool({
  host,
  port,
  database: adminDatabase,
  user: adminUser,
  password: adminPassword,
  connectionTimeoutMillis: 5_000,
  max: 1,
});
let migrationPool;
let app;
let cleanupPromise;

try {
  await admin.query(
    `CREATE ROLE ${quoteIdentifier(migrationRole)} LOGIN PASSWORD ${quoteLiteral(migrationPassword)}`,
  );
  await admin.query(
    `CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN PASSWORD ${quoteLiteral(runtimePassword)}`,
  );
  await admin.query(
    `CREATE DATABASE ${quoteIdentifier(database)} OWNER ${quoteIdentifier(migrationRole)}`,
  );

  migrationPool = new Pool({
    host,
    port,
    database,
    user: migrationRole,
    password: migrationPassword,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  await migrate(drizzle(migrationPool), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const { grantRuntimePrivileges } =
    await import("../dist/platform/database/grant-runtime-privileges.js");
  await grantRuntimePrivileges(migrationPool, database, runtimeRole);
  await migrationPool.end();
  migrationPool = undefined;

  process.env.POSTGRES_HOST = host;
  process.env.POSTGRES_PORT = String(port);
  process.env.POSTGRES_DB = database;
  process.env.POSTGRES_USER = runtimeRole;
  process.env.POSTGRES_PASSWORD = runtimePassword;
  process.env.MIGRATION_POSTGRES_USER = migrationRole;
  process.env.MIGRATION_POSTGRES_PASSWORD = migrationPassword;
  process.env.REDIS_URL = redisUrl.toString();
  process.env.BETTER_AUTH_REDIS_KEY_PREFIX = redisPrefix;
  process.env.BETTER_AUTH_SECRET =
    "test-only-better-auth-secret-with-32-bytes-minimum";
  process.env.BETTER_AUTH_URL = `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3181}`;
  process.env.CLIENT_URL = `http://${process.env.HOST ?? "127.0.0.1"}:3180`;

  const [{ AppModule }, { configureApp }] = await Promise.all([
    import("../dist/app.module.js"),
    import("../dist/configure-app.js"),
  ]);
  app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false,
  });
  configureApp(app);
  await app.listen(
    Number(process.env.PORT ?? 3181),
    process.env.HOST ?? "127.0.0.1",
  );
} catch (error) {
  await cleanup();
  throw error;
}

process.once("SIGTERM", () => void cleanup().then(() => process.exit(0)));
process.once("SIGINT", () => void cleanup().then(() => process.exit(0)));

async function cleanup() {
  cleanupPromise ??= (async () => {
    await app?.close();
    await migrationPool?.end();
    const redis = new Redis(redisUrl.toString(), { maxRetriesPerRequest: 1 });
    try {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(
          cursor,
          "MATCH",
          `${redisPrefix}*`,
          "COUNT",
          100,
        );
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== "0");
    } catch {
      // Continue tearing down the isolated database and roles if Redis is offline.
    } finally {
      redis.disconnect();
    }
    try {
      await admin.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`,
      );
    } finally {
      await admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(runtimeRole)}`);
      await admin.query(
        `DROP ROLE IF EXISTS ${quoteIdentifier(migrationRole)}`,
      );
      await admin.end();
    }
  })();
  return cleanupPromise;
}

function isLoopbackHost(value) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    (isIP(normalized) === 4 && Number(normalized.split(".")[0]) === 127)
  );
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
