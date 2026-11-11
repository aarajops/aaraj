import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { configuredRole, required } from "./migration-support.mjs";

const addressColumns = [
  "address_ciphertext",
  "address_name_prefixes",
  "address_phone_prefixes",
];

export async function backfillOrderAddressCiphertext(client, crypto) {
  const { OrderAddressSchema } = await import("@aaraj/contracts");
  let converted = 0;
  await client.query("BEGIN");
  try {
    await client.query(
      'LOCK TABLE "orders"."order_header" IN ACCESS EXCLUSIVE MODE',
    );
    for (const column of addressColumns) {
      const type = column.endsWith("prefixes") ? "text[]" : "text";
      await client.query(
        `ALTER TABLE "orders"."order_header" ADD COLUMN IF NOT EXISTS "${column}" ${type}`,
      );
    }
    await client.query(
      'ALTER TABLE "orders"."order_header" DISABLE TRIGGER "order_header_protect_update"',
    );

    let cursor;
    while (true) {
      const result = cursor
        ? await client.query(
            `SELECT "id", "address_snapshot", "address_ciphertext"
               FROM "orders"."order_header"
              WHERE "id" > $1::uuid
                AND ("address_ciphertext" IS NULL
                  OR "address_name_prefixes" IS NULL
                  OR "address_phone_prefixes" IS NULL
                  OR split_part("address_ciphertext", '.', 1) <> 'v2'
                  OR "address_snapshot" <> '{}'::jsonb)
              ORDER BY "id"
              LIMIT 500`,
            [cursor],
          )
        : await client.query(
            `SELECT "id", "address_snapshot", "address_ciphertext"
               FROM "orders"."order_header"
              WHERE "address_ciphertext" IS NULL
                OR "address_name_prefixes" IS NULL
                OR "address_phone_prefixes" IS NULL
                OR split_part("address_ciphertext", '.', 1) <> 'v2'
                OR "address_snapshot" <> '{}'::jsonb
              ORDER BY "id"
              LIMIT 500`,
          );
      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        const hasPlaintextAddress =
          row.address_snapshot &&
          typeof row.address_snapshot === "object" &&
          Object.keys(row.address_snapshot).length > 0;
        const address = hasPlaintextAddress
          ? OrderAddressSchema.parse(row.address_snapshot)
          : crypto.decryptOrderAddress(row.id, row.address_ciphertext);
        const ciphertext = crypto.encryptOrderAddress(row.id, address);
        const lookups = crypto.makeOrderAddressLookups(address);
        await client.query(
          `UPDATE "orders"."order_header"
              SET "address_ciphertext" = $2,
                  "address_name_prefixes" = $3::text[],
                  "address_phone_prefixes" = $4::text[],
                  "address_snapshot" = '{}'::jsonb
            WHERE "id" = $1::uuid`,
          [row.id, ciphertext, lookups.namePrefixes, lookups.phonePrefixes],
        );
      }
      cursor = result.rows.at(-1).id;
      converted += result.rows.length;
    }

    await client.query(
      'ALTER TABLE "orders"."order_header" ENABLE TRIGGER "order_header_protect_update"',
    );
    const remaining = await client.query(
      `SELECT count(*)::integer AS "count"
         FROM "orders"."order_header"
        WHERE "address_ciphertext" IS NULL
           OR "address_name_prefixes" IS NULL
           OR "address_phone_prefixes" IS NULL
           OR split_part("address_ciphertext", '.', 1) <> 'v2'
           OR "address_snapshot" <> '{}'::jsonb`,
    );
    if (remaining.rows[0].count !== 0) {
      throw new Error("Some Order addresses could not be encrypted.");
    }
    await client.query("COMMIT");
    process.stdout.write(
      `Encrypted ${converted} Order address(es) and removed plaintext snapshots.\n`,
    );
    return converted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--execute") {
    throw new Error(
      "Use --check or --execute for this Order address migration.",
    );
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
    const columns = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'orders'
          AND table_name = 'order_header'
          AND column_name = ANY($1::text[])`,
      [["address_snapshot", ...addressColumns]],
    );
    const present = new Set(columns.rows.map((row) => row.column_name));
    if (!present.has("address_snapshot")) {
      process.stdout.write("complete\n");
    } else if (addressColumns.some((column) => !present.has(column))) {
      process.stdout.write("required\n");
    } else {
      const status = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM "orders"."order_header"
            WHERE "address_ciphertext" IS NULL
               OR "address_name_prefixes" IS NULL
               OR "address_phone_prefixes" IS NULL
               OR split_part("address_ciphertext", '.', 1) <> 'v2'
               OR "address_snapshot" <> '{}'::jsonb
         ) AS required`,
      );
      if (!status.rows[0].required) {
        process.stdout.write("complete\n");
      } else if (mode === "--check") {
        process.stdout.write("required\n");
      } else {
        const [{ readOrderPiiKeyring }, crypto] = await Promise.all([
          import("../dist/platform/crypto/order-pii-keyring.js"),
          import("../dist/orders/order-address-crypto.js"),
        ]);
        if (
          !process.env.ORDER_PII_KEYRING?.trim() &&
          !process.env.ORDER_PII_ENCRYPTION_KEY?.trim()
        ) {
          throw new Error(
            "Configure Order PII encryption keys before conversion.",
          );
        }
        readOrderPiiKeyring();
        await backfillOrderAddressCiphertext(client, crypto);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
