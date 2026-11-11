import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  configuredRole,
  migrateBeforeJournalIndex,
  required,
} from "./migration-support.mjs";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);
const localEnvironmentFile = fileURLToPath(
  new URL("../../../infrastructure/local/.env.local", import.meta.url),
);

if (existsSync(localEnvironmentFile)) {
  process.loadEnvFile(localEnvironmentFile);
}
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "Use the staged production migration entrypoint in production.",
  );
}
process.env.NODE_ENV ??= "development";

const converter = fileURLToPath(
  new URL("./backfill-order-address-snapshots.mjs", import.meta.url),
);
const preflight = run(process.execPath, [converter, "--check"], {
  captureOutput: true,
});
if (preflight !== "complete" && preflight !== "required") {
  throw new Error(
    "Order address migration preflight returned an unexpected result.",
  );
}

if (preflight === "required") {
  buildApi();
  run(process.execPath, [converter, "--execute"]);
}

await migrateLocalThroughOrderAddressBarrier();

const ciphertextConverter = fileURLToPath(
  new URL("./backfill-order-address-ciphertext.mjs", import.meta.url),
);
const ciphertextPreflight = run(
  process.execPath,
  [ciphertextConverter, "--check"],
  { captureOutput: true },
);
if (ciphertextPreflight === "required") {
  buildApi();
  run(process.execPath, [ciphertextConverter, "--execute"]);
} else if (ciphertextPreflight !== "complete") {
  throw new Error(
    "Order address encryption preflight returned an unexpected result.",
  );
}

const [{ drizzle }, { migrate }, { Pool }] = await Promise.all([
  import("drizzle-orm/node-postgres"),
  import("drizzle-orm/node-postgres/migrator"),
  import("pg"),
]);
const pool = new Pool({
  host: process.env.POSTGRES_HOST?.trim() || "127.0.0.1",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: required("POSTGRES_DB"),
  user: configuredRole("MIGRATION_POSTGRES_USER", "POSTGRES_USER"),
  password: configuredRole("MIGRATION_POSTGRES_PASSWORD", "POSTGRES_PASSWORD"),
  ssl: false,
  max: 1,
  connectionTimeoutMillis: 5_000,
});
try {
  await migrate(drizzle(pool), { migrationsFolder: migrationsDirectory });
} finally {
  await pool.end();
}

async function migrateLocalThroughOrderAddressBarrier() {
  const journalPath = fileURLToPath(
    new URL("../drizzle/meta/_journal.json", import.meta.url),
  );
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const barrierIndex = journal.entries.findIndex(
    (entry) => entry.tag === "0066_order_address_encryption_expand",
  );
  if (barrierIndex < 0) return;

  const { Pool } = await import("pg");
  const pool = new Pool({
    host: process.env.POSTGRES_HOST?.trim() || "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: required("POSTGRES_DB"),
    user: configuredRole("MIGRATION_POSTGRES_USER", "POSTGRES_USER"),
    password: configuredRole(
      "MIGRATION_POSTGRES_PASSWORD",
      "POSTGRES_PASSWORD",
    ),
    ssl: false,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await migrateBeforeJournalIndex(
      pool,
      migrationsDirectory,
      barrierIndex,
      "aaraj-local-migrations-before-address-",
    );
  } finally {
    await pool.end();
  }
}

function buildApi() {
  run("pnpm", ["--filter", "@aaraj/contracts", "run", "build"]);
  run("pnpm", ["--filter", "@aaraj/api", "run", "build"]);
}

function run(command, args, { captureOutput = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: apiDirectory,
    env: process.env,
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }
  return captureOutput ? result.stdout.trim() : undefined;
}
