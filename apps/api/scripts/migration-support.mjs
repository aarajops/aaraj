import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function required(name, context) {
  const value = process.env[name]?.trim();
  if (!value) {
    const suffix = context ? ` for ${context}` : "";
    throw new Error(`${name} must be configured${suffix}.`);
  }
  return value;
}

export function configuredRole(primary, localFallback) {
  const value = process.env[primary]?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") return required(primary);
  return required(localFallback);
}

export async function migrateBeforeJournalIndex(
  pool,
  migrationsDirectory,
  index,
  temporaryPrefix,
) {
  const [{ drizzle }, { migrate }] = await Promise.all([
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), temporaryPrefix),
  );
  try {
    const metadataDirectory = path.join(temporaryDirectory, "meta");
    await mkdir(metadataDirectory);
    const journal = JSON.parse(
      await readFile(
        path.join(migrationsDirectory, "meta/_journal.json"),
        "utf8",
      ),
    );
    const entries = journal.entries.slice(0, index);
    await writeFile(
      path.join(metadataDirectory, "_journal.json"),
      JSON.stringify({ ...journal, entries }, null, 2),
    );
    for (const entry of entries) {
      await copyFile(
        path.join(migrationsDirectory, `${entry.tag}.sql`),
        path.join(temporaryDirectory, `${entry.tag}.sql`),
      );
    }
    await migrate(drizzle(pool), { migrationsFolder: temporaryDirectory });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
