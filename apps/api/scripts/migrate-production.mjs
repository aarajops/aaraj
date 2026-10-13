import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { getPostgresSslOptions } from "../dist/platform/database/postgres-ssl.js";
import { grantRuntimePrivileges } from "../dist/platform/database/grant-runtime-privileges.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiDirectory = path.resolve(scriptDirectory, "..");
const migrationsDirectory = path.join(apiDirectory, "drizzle");
const manifestPath = path.resolve(apiDirectory, "../release-manifest.json");

if (process.env.NODE_ENV !== "production") {
  throw new Error("Production migrations require NODE_ENV=production.");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const releaseSha = String(manifest.commit ?? "").toLowerCase();
if (
  manifest.application !== "aaraj" ||
  !/^[0-9a-f]{40}$/.test(releaseSha) ||
  manifest.dirty !== false ||
  (process.env.RELEASE_COMMIT_SHA &&
    process.env.RELEASE_COMMIT_SHA.toLowerCase() !== releaseSha)
) {
  throw new Error(
    "The migration files do not match a clean, staged AARAJ release.",
  );
}

const database = required("POSTGRES_DB");
const runtimeUser = required("POSTGRES_USER");
const migrationUser = required("MIGRATION_POSTGRES_USER");
const migrationPassword = required("MIGRATION_POSTGRES_PASSWORD");
const host = required("POSTGRES_HOST");
const port = Number(process.env.POSTGRES_PORT ?? 5432);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("POSTGRES_PORT must be a valid TCP port.");
}
if (migrationUser === runtimeUser) {
  throw new Error(
    "Production migrations require a role separate from the runtime role.",
  );
}

const migrations = await readMigrationHistory(migrationsDirectory);
const pool = new Pool({
  host,
  port,
  database,
  user: migrationUser,
  password: migrationPassword,
  ssl: getPostgresSslOptions(),
  max: 2,
  connectionTimeoutMillis: 5_000,
  options: "-c search_path=pg_catalog",
});
const lock = await pool.connect();

try {
  await lock.query("SELECT pg_advisory_lock(hashtext($1))", [
    "aaraj:production:drizzle-migrations:v1",
  ]);
  const applied = await readAppliedHistory(lock, migrations);
  await migrate(drizzle(pool), { migrationsFolder: migrationsDirectory });
  const after = await readAppliedHistory(lock, migrations);
  if (after.length !== migrations.length) {
    throw new Error(
      "Drizzle migration journal did not reach the staged release state.",
    );
  }
  await grantRuntimePrivileges(pool, database, runtimeUser);
  process.stdout.write(
    `Drizzle migrations are current for ${releaseSha}; ${after.length - applied.length} migration(s) applied and runtime grants reconciled.\n`,
  );
} finally {
  try {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [
      "aaraj:production:drizzle-migrations:v1",
    ]);
  } finally {
    lock.release();
    await pool.end();
  }
}

async function readMigrationHistory(directory) {
  const journal = JSON.parse(
    await readFile(path.join(directory, "meta/_journal.json"), "utf8"),
  );
  const migrations = [];
  for (const entry of journal.entries) {
    if (
      !/^[0-9]{4}_[a-z0-9_]+$/.test(entry.tag) ||
      !Number.isSafeInteger(entry.when)
    ) {
      throw new Error(
        "The Drizzle migration journal contains an invalid entry.",
      );
    }
    const sql = await readFile(
      path.join(directory, `${entry.tag}.sql`),
      "utf8",
    );
    migrations.push({
      tag: entry.tag,
      when: entry.when,
      sql,
      hash: createHash("sha256").update(sql).digest("hex"),
    });
  }
  return migrations;
}

async function readAppliedHistory(client, migrations) {
  let result;
  try {
    result = await client.query(
      "SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at ASC",
    );
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "3F000") throw error;
    const schemas = await client.query(
      "SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])",
      [
        [
          "identity",
          "audit",
          "access",
          "catalog",
          "inventory",
          "cart",
          "geography",
          "delivery",
          "tax",
          "quote",
          "orders",
        ],
      ],
    );
    if (schemas.rowCount) {
      throw new Error(
        "Database has AARAJ schemas but no Drizzle migration history; refusing to guess state.",
      );
    }
    return [];
  }

  if (result.rows.length > migrations.length) {
    throw new Error(
      "Database Drizzle history is ahead of the staged artifact.",
    );
  }
  for (const [index, row] of result.rows.entries()) {
    const expected = migrations[index];
    if (
      !expected ||
      row.hash !== expected.hash ||
      String(row.created_at) !== String(expected.when)
    ) {
      throw new Error(
        `Database migration history does not match at journal entry ${index}.`,
      );
    }
  }
  return result.rows.map((row) => row.hash);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} must be configured for production migrations.`);
  return value;
}
