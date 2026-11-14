import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export async function protectOrderAddressSnapshots(client) {
  const [{ OrderAddressSchema }, crypto] = await Promise.all([
    import("@aaraj/contracts"),
    import("../dist/orders/order-address-crypto.js"),
  ]);
  const {
    decryptOrderAddressSnapshot,
    encryptOrderAddressSnapshot,
    orderAddressSearchTokens,
  } = crypto;
  let protectedCount = 0;
  await client.query("BEGIN");
  try {
    await client.query(
      'LOCK TABLE "orders"."order_header" IN ACCESS EXCLUSIVE MODE',
    );
    const columns = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'orders'
          AND table_name = 'order_header'
          AND column_name IN ('address_snapshot', 'address_search_tokens')`,
    );
    if (columns.rowCount !== 2) {
      throw new Error(
        "Migration 0065 must run before protecting Order addresses.",
      );
    }

    await client.query(
      'ALTER TABLE "orders"."order_header" DISABLE TRIGGER "order_header_protect_update"',
    );
    await client.query(
      'ALTER TABLE "orders"."order_header" DISABLE TRIGGER "order_address_search_tokens_protect_update"',
    );

    let cursor;
    while (true) {
      const result = cursor
        ? await client.query(
            `SELECT "id", "address_snapshot", "address_search_tokens"
               FROM "orders"."order_header"
              WHERE "id" > $1::uuid
              ORDER BY "id"
              LIMIT 500`,
            [cursor],
          )
        : await client.query(
            `SELECT "id", "address_snapshot", "address_search_tokens"
               FROM "orders"."order_header"
              ORDER BY "id"
              LIMIT 500`,
          );
      if (result.rows.length === 0) break;

      const values = [];
      const parameters = [];
      for (const [index, row] of result.rows.entries()) {
        const isEncrypted =
          row.address_snapshot &&
          typeof row.address_snapshot === "object" &&
          row.address_snapshot.version === 3;
        const address = isEncrypted
          ? decryptOrderAddressSnapshot(row.id, row.address_snapshot)
          : OrderAddressSchema.parse(row.address_snapshot);
        const snapshot = isEncrypted
          ? row.address_snapshot
          : encryptOrderAddressSnapshot(row.id, address);
        const tokens = orderAddressSearchTokens(address);
        const offset = index * 3;
        parameters.push(row.id, JSON.stringify(snapshot), tokens);
        values.push(
          `($${offset + 1}::uuid, $${offset + 2}::jsonb, $${offset + 3}::text[])`,
        );
      }
      await client.query(
        `UPDATE "orders"."order_header" AS target
            SET "address_snapshot" = source."address_snapshot",
                "address_search_tokens" = source."address_search_tokens"
           FROM (VALUES ${values.join(", ")}) AS source("id", "address_snapshot", "address_search_tokens")
          WHERE target."id" = source."id"`,
        parameters,
      );
      cursor = result.rows.at(-1).id;
      protectedCount += result.rows.length;
    }

    await client.query(
      'ALTER TABLE "orders"."order_header" ENABLE TRIGGER "order_header_protect_update"',
    );
    await client.query(
      'ALTER TABLE "orders"."order_header" ENABLE TRIGGER "order_address_search_tokens_protect_update"',
    );
    await client.query(
      'ALTER TABLE "orders"."order_header" ALTER COLUMN "address_search_tokens" SET NOT NULL',
    );
    await client.query(
      'ALTER TABLE "orders"."order_header" VALIDATE CONSTRAINT "order_address_search_tokens_check"',
    );
    const invalid = await client.query(
      `SELECT count(*)::integer AS "count"
         FROM "orders"."order_header"
        WHERE "address_snapshot"->>'version' IS DISTINCT FROM '3'
           OR "address_search_tokens" IS NULL
           OR cardinality("address_search_tokens") = 0`,
    );
    if (invalid.rows[0].count !== 0) {
      throw new Error("Some Order addresses remain unprotected.");
    }
    await client.query("COMMIT");
    process.stdout.write(
      `Protected ${protectedCount} Order address snapshot(s).\n`,
    );
    return protectedCount;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function orderAddressProtectionStatus(client) {
  const columns = await client.query(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'orders'
        AND table_name = 'order_header'
        AND column_name IN ('address_snapshot', 'address_search_tokens')`,
  );
  if (columns.rowCount !== 2) return "schema-missing";

  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM "orders"."order_header"
        WHERE "address_snapshot"->>'version' IS DISTINCT FROM '3'
           OR "address_search_tokens" IS NULL
           OR cardinality("address_search_tokens") = 0
     ) AS "rows_need_protection",
     EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conrelid = 'orders.order_header'::regclass
          AND conname = 'order_address_search_tokens_check'
          AND convalidated
     ) AS "constraint_validated",
     EXISTS (
       SELECT 1
         FROM pg_trigger
        WHERE tgrelid = 'orders.order_header'::regclass
          AND tgname = 'order_address_search_tokens_protect_update'
          AND tgenabled = 'O'
          AND NOT tgisinternal
     ) AS "trigger_enabled"`,
  );
  const nullable = columns.rows.some(
    (column) =>
      column.column_name === "address_search_tokens" &&
      column.is_nullable === "YES",
  );
  const state = result.rows[0];
  return state.rows_need_protection ||
    nullable ||
    !state.constraint_validated ||
    !state.trigger_enabled
    ? "required"
    : "complete";
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--execute") {
    throw new Error("Use --check or --execute for Order address protection.");
  }
  const ssl =
    process.env.NODE_ENV === "production"
      ? (
          await import("../dist/platform/database/postgres-ssl.js")
        ).getPostgresSslOptions()
      : false;
  const pool = new Pool({
    host: process.env.POSTGRES_HOST?.trim() || "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: required("POSTGRES_DB"),
    user: configuredRole("MIGRATION_POSTGRES_USER", "POSTGRES_USER"),
    password: configuredRole(
      "MIGRATION_POSTGRES_PASSWORD",
      "POSTGRES_PASSWORD",
    ),
    ssl,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  const client = await pool.connect();
  try {
    if (mode === "--check") {
      process.stdout.write(`${await orderAddressProtectionStatus(client)}\n`);
      return;
    }
    const currentStatus = await orderAddressProtectionStatus(client);
    if (currentStatus === "complete") {
      process.stdout.write("Order address protection is already complete.\n");
      return;
    }
    if (currentStatus === "schema-missing") {
      throw new Error(
        "Migration 0065 must run before protecting Order addresses.",
      );
    }
    const { readOrderPiiKeyring } =
      await import("../dist/platform/crypto/order-pii-keyring.js");
    readOrderPiiKeyring();
    await protectOrderAddressSnapshots(client);
    const status = await orderAddressProtectionStatus(client);
    if (status !== "complete") {
      throw new Error(
        "Order address protection did not complete successfully.",
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

function configuredRole(primary, localFallback) {
  const value = process.env[primary]?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") return required(primary);
  return required(localFallback);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
