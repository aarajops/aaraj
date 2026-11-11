import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import { configuredRole, required } from "./migration-support.mjs";

const localEnvironmentFile = fileURLToPath(
  new URL("../../../infrastructure/local/.env.local", import.meta.url),
);
if (process.env.NODE_ENV !== "production" && existsSync(localEnvironmentFile)) {
  process.loadEnvFile(localEnvironmentFile);
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--execute") {
    throw new Error("Use --check or --execute for Order address key rotation.");
  }

  const [{ readOrderPiiKeyring }, crypto] = await Promise.all([
    import("../dist/platform/crypto/order-pii-keyring.js"),
    import("../dist/orders/order-address-crypto.js"),
  ]);
  const keyring = readOrderPiiKeyring();
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
    const status = await client.query(
      `SELECT count(*)::integer AS "count"
         FROM "orders"."order_header"
        WHERE split_part("address_ciphertext", '.', 1) <> 'v2'
           OR split_part("address_ciphertext", '.', 2) <> $1`,
      [keyring.activeKeyId],
    );
    const pending = status.rows[0].count;
    if (mode === "--check") {
      process.stdout.write(pending === 0 ? "complete\n" : "required\n");
      return;
    }
    if (pending === 0) {
      process.stdout.write("Order addresses already use the active key.\n");
      return;
    }

    await client.query("BEGIN");
    try {
      await client.query(
        'LOCK TABLE "orders"."order_header" IN ACCESS EXCLUSIVE MODE',
      );
      await client.query(
        'ALTER TABLE "orders"."order_header" DISABLE TRIGGER "order_header_protect_update"',
      );
      let cursor;
      let reencrypted = 0;
      while (true) {
        const result = cursor
          ? await client.query(
              `SELECT "id", "address_ciphertext"
                 FROM "orders"."order_header"
                WHERE "id" > $1::uuid
                ORDER BY "id"
                LIMIT 500`,
              [cursor],
            )
          : await client.query(
              `SELECT "id", "address_ciphertext"
                 FROM "orders"."order_header"
                ORDER BY "id"
                LIMIT 500`,
            );
        if (result.rows.length === 0) break;

        for (const row of result.rows) {
          const address = crypto.decryptOrderAddress(
            row.id,
            row.address_ciphertext,
          );
          const fields = row.address_ciphertext.split(".");
          const sourceKeyId = fields[0] === "v1" ? "legacy" : fields[1];
          const alreadyCurrent =
            fields[0] === "v2" && sourceKeyId === keyring.activeKeyId;
          if (alreadyCurrent) continue;

          await client.query(
            `UPDATE "orders"."order_header"
                SET "address_ciphertext" = $2
              WHERE "id" = $1::uuid`,
            [row.id, crypto.encryptOrderAddress(row.id, address)],
          );
          await client.query(
            `INSERT INTO "audit"."event"
               ("actor_type", "event_type", "subject_type", "subject_id", "reason", "metadata")
             VALUES
               ('service', 'commerce.order_address_reencrypted', 'order', $1,
                'Order address ciphertext was re-encrypted under the active key.',
                jsonb_build_object('sourceKeyId', $2, 'activeKeyId', $3))`,
            [row.id, sourceKeyId, keyring.activeKeyId],
          );
          reencrypted += 1;
        }
        cursor = result.rows.at(-1).id;
      }

      await client.query(
        'ALTER TABLE "orders"."order_header" ENABLE TRIGGER "order_header_protect_update"',
      );
      const remaining = await client.query(
        `SELECT count(*)::integer AS "count"
           FROM "orders"."order_header"
          WHERE split_part("address_ciphertext", '.', 1) <> 'v2'
             OR split_part("address_ciphertext", '.', 2) <> $1`,
        [keyring.activeKeyId],
      );
      if (remaining.rows[0].count !== 0) {
        throw new Error("Some Order addresses still use an older key.");
      }
      await client.query("COMMIT");
      process.stdout.write(`Re-encrypted ${reencrypted} Order address(es).\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
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
