import { createDecipheriv } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export async function backfillOrderAddressSnapshots(client, keyring) {
  const { OrderAddressSchema } = await import("@aaraj/contracts");
  let converted = 0;
  await client.query("BEGIN");
  try {
    await client.query(
      'LOCK TABLE "orders"."order_header" IN ACCESS EXCLUSIVE MODE',
    );
    await client.query(
      'ALTER TABLE "orders"."order_header" ADD COLUMN IF NOT EXISTS "address_snapshot" jsonb',
    );
    await client.query(
      'ALTER TABLE "orders"."order_header" DISABLE TRIGGER "order_header_protect_update"',
    );

    let cursor;
    while (true) {
      const result = cursor
        ? await client.query(
            `SELECT "id", "address_ciphertext"
               FROM "orders"."order_header"
              WHERE "address_snapshot" IS NULL AND "id" > $1::uuid
              ORDER BY "id"
              LIMIT 500`,
            [cursor],
          )
        : await client.query(
            `SELECT "id", "address_ciphertext"
               FROM "orders"."order_header"
              WHERE "address_snapshot" IS NULL
              ORDER BY "id"
              LIMIT 500`,
          );
      if (result.rows.length === 0) break;

      const values = [];
      const parameters = [];
      for (const [index, row] of result.rows.entries()) {
        const address = decryptAddress(
          row.address_ciphertext,
          row.id,
          keyring,
          OrderAddressSchema,
        );
        parameters.push(row.id, JSON.stringify(address));
        values.push(`($${index * 2 + 1}::uuid, $${index * 2 + 2}::jsonb)`);
      }
      await client.query(
        `UPDATE "orders"."order_header" AS target
            SET "address_snapshot" = source."address_snapshot"
           FROM (VALUES ${values.join(", ")}) AS source("id", "address_snapshot")
          WHERE target."id" = source."id"
            AND target."address_snapshot" IS NULL`,
        parameters,
      );
      cursor = result.rows.at(-1).id;
      converted += result.rows.length;
    }

    await client.query(
      'ALTER TABLE "orders"."order_header" ENABLE TRIGGER "order_header_protect_update"',
    );
    const remaining = await client.query(
      'SELECT count(*)::integer AS "count" FROM "orders"."order_header" WHERE "address_snapshot" IS NULL',
    );
    if (remaining.rows[0].count !== 0) {
      throw new Error("Some Orders are missing an address snapshot.");
    }
    await client.query("COMMIT");
    process.stdout.write(`Converted ${converted} Order address snapshot(s).\n`);
    return converted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function decryptAddress(value, orderId, keyring, addressSchema) {
  try {
    if (typeof value !== "string") throw new Error("Address is missing.");
    const [version, ...fields] = value.split(".");
    const isV1 = version === "v1" && fields.length === 3;
    const isV2 =
      version === "v2" &&
      fields.length === 4 &&
      /^[A-Za-z0-9_-]+$/.test(fields[0] ?? "");
    if (!isV1 && !isV2) throw new Error("Unsupported address envelope.");

    const [keyId, nonceValue, ciphertextValue, tagValue] = isV1
      ? ["legacy", ...fields]
      : fields;
    const key = keyring.keys.get(keyId);
    if (!key || !nonceValue || !ciphertextValue || !tagValue) {
      throw new Error("Address key or ciphertext field is missing.");
    }
    const nonce = Buffer.from(nonceValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (nonce.length !== 12 || tag.length !== 16) {
      throw new Error("Address envelope is invalid.");
    }

    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(
      Buffer.from(
        isV1
          ? `aaraj/order-address/v1:${orderId}`
          : `aaraj/order-address/v2:${keyId}:${orderId}`,
      ),
    );
    decipher.setAuthTag(tag);
    const address = JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      ),
    );
    return addressSchema.parse(address);
  } catch {
    throw new Error(
      "Could not convert every Order address. No changes were committed; check configured legacy keys and ciphertext before retrying.",
    );
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--execute") {
    throw new Error("Use --check or --execute for this one-time conversion.");
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
    const oldColumn = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'orders'
           AND table_name = 'order_header'
           AND column_name = 'address_ciphertext'
       ) AS present`,
    );
    if (!oldColumn.rows[0].present) {
      process.stdout.write("complete\n");
    } else if (mode === "--check") {
      process.stdout.write("required\n");
    } else {
      const { readOrderPiiKeyring } =
        await import("../dist/platform/crypto/order-pii-keyring.js");
      await backfillOrderAddressSnapshots(client, readOrderPiiKeyring());
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
