#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const [baseline, commit] = process.argv.slice(2);
const classifications = new Set(["compatible", "maintenance"]);
if (!baseline || !commit) {
  throw new Error(
    "Usage: check-migration-policy.mjs <baseline-tag> <commit-sha>",
  );
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

const changes = git([
  "diff",
  "--name-status",
  "--no-renames",
  baseline,
  commit,
  "--",
  "apps/api/drizzle",
])
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"));

for (const [status, file] of changes) {
  if (file.endsWith(".sql") && status !== "A") {
    throw new Error(
      `Released migration ${file} was ${status === "D" ? "deleted" : "modified"}.`,
    );
  }
}

const migrations = changes
  .filter(([status, file]) => status === "A" && file.endsWith(".sql"))
  .map(([, file]) => {
    const name = file.slice("apps/api/drizzle/".length);
    if (!/^\d+_[a-z0-9_]+\.sql$/.test(name)) {
      throw new Error(`Migration filename is invalid: ${file}`);
    }
    return name;
  });

const impact = JSON.parse(
  git(["show", `${commit}:infrastructure/production/migration-impact.json`]),
);

const classified = migrations.map((file) => {
  const classification = impact[file];
  if (!classifications.has(classification)) {
    throw new Error(
      `${file} needs a compatible or maintenance classification.`,
    );
  }
  return { file, impact: classification };
});

process.stdout.write(
  `${JSON.stringify({
    required: classified.length > 0,
    maintenanceRequired: classified.some(
      ({ impact: value }) => value === "maintenance",
    ),
    migrations: classified,
  })}\n`,
);
