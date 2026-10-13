import { createHmac, randomBytes, randomUUID } from "node:crypto";
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
const throttlerPrefix = `aaraj:throttler:integration-${testId}:`;
const catalogCachePrefix = `aaraj:integration-${testId}:catalog:`;
const cartPrefix = `aaraj:integration-${testId}:cart:guest:`;
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
  await migrationPool.query(
    `INSERT INTO "tax"."profile" (
       "version", "effective_from", "legal_merchant_reference",
       "registration_status", "operating_model", "price_presentation",
       "product_treatment", "product_rate_numerator", "product_rate_denominator",
       "delivery_treatment", "rounding_rule", "source_reference", "source_version",
       "approval_reference", "approved", "test_only"
     ) VALUES (
       'TEST_ONLY_BD_RETAIL_TAX_RULE_V1', '2020-01-01', 'TEST_ONLY synthetic merchant fixture',
       'not_required', 'direct_retailer', 'vat_inclusive',
       'taxable', 3, 17, 'exempt', 'half_up_bdt_v1',
       'TEST_ONLY synthetic fixture; not legal guidance', 'TEST_ONLY_V1',
       'TEST_ONLY_AUTOMATED_FIXTURE', true, true
     )`,
  );
  await migrationPool.query(
    `UPDATE "tax"."configuration" SET "enabled" = true WHERE "id" = 'default'`,
  );
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
  process.env.THROTTLER_REDIS_KEY_PREFIX = throttlerPrefix;
  process.env.CATALOG_CACHE_KEY_PREFIX = catalogCachePrefix;
  process.env.CART_REDIS_KEY_PREFIX = cartPrefix;
  process.env.BETTER_AUTH_SECRET =
    "test-only-better-auth-secret-with-32-bytes-minimum";
  process.env.ORDER_PII_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
  process.env.BETTER_AUTH_URL = `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3181}`;
  process.env.CLIENT_URL = `http://${process.env.HOST ?? "127.0.0.1"}:3180`;

  Object.assign(process.env, {
    PATHAO_MODE: "sandbox",
    PATHAO_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    PATHAO_SANDBOX_CLIENT_ID: "pathao-browser-e2e-client",
    PATHAO_SANDBOX_CLIENT_SECRET: "pathao-browser-e2e-client-secret",
    PATHAO_SANDBOX_USERNAME: "pathao-browser-e2e@example.invalid",
    PATHAO_SANDBOX_PASSWORD: "pathao-browser-e2e-only-password",
    PATHAO_SANDBOX_WEBHOOK_SECRET: "pathao-browser-e2e-webhook-secret",
    PATHAO_SANDBOX_APPROVED_STORE_IDS: "101",
    PATHAO_SANDBOX_DELIVERY_TYPES: "48",
  });

  const networkFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    const url = new URL(requestUrl);
    if (url.origin !== "https://courier-api-sandbox.pathao.com") {
      return networkFetch(input, init);
    }
    if (url.pathname.endsWith("/issue-token")) {
      return new Response(
        JSON.stringify({
          token_type: "Bearer",
          expires_in: 3600,
          access_token: "pathao-browser-e2e-access",
          refresh_token: "pathao-browser-e2e-refresh",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.pathname.endsWith("/stores")) {
      return new Response(
        JSON.stringify({
          data: {
            data: [
              { store_id: 101, store_name: "Browser E2E Store", is_active: 1 },
            ],
            last_page: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.pathname.endsWith("/orders") && init?.method === "POST") {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      return new Response(
        JSON.stringify({
          data: {
            consignment_id: "PATHAO-BROWSER-E2E-01",
            merchant_order_id: body.merchant_order_id,
            order_status: "Pending",
            delivery_fee: 83.46,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.pathname.includes("/orders/") && url.pathname.endsWith("/info")) {
      const consignmentId = decodeURIComponent(url.pathname.split("/").at(-2));
      return new Response(
        JSON.stringify({
          data: {
            consignment_id: consignmentId,
            merchant_order_id: null,
            order_status_slug: "pending",
            updated_at: "2026-10-10T00:00:00Z",
            invoice_id: null,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  const [{ AppModule }, { configureApp }, { auth }, { AccessService }] =
    await Promise.all([
      import("../dist/app.module.js"),
      import("../dist/configure-app.js"),
      import("../dist/auth/auth.js"),
      import("../dist/platform/authorization/access.service.js"),
    ]);
  app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false,
    cookies: {
      secret: createHmac("sha256", process.env.BETTER_AUTH_SECRET)
        .update("aaraj/cart-cookie-signing/v1")
        .digest("hex"),
    },
  });
  configureApp(app);
  await app.init();

  const fixtureEmail = "catalog-e2e@example.test";
  const fixturePassword = "CatalogE2E-Only-Password-2026!";
  const fixtureResponse = await auth.api.signUpEmail({
    body: {
      name: "E2E Catalog Operator",
      email: fixtureEmail,
      password: fixturePassword,
    },
    headers: new Headers({ Origin: process.env.CLIENT_URL }),
    asResponse: true,
  });
  if (!fixtureResponse.ok) {
    throw new Error("Could not create the isolated catalog E2E account.");
  }
  const { user } = await fixtureResponse.json();
  await app
    .get(AccessService)
    .bootstrapSuperadmin(user.id, { reason: "Isolated browser E2E fixture" });

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
      for (const prefix of [redisPrefix, throttlerPrefix, catalogCachePrefix]) {
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
      }
    } catch {
      // Continue tearing down the isolated database and roles if Redis is offline.
    } finally {
      redis.disconnect();
    }
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
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
