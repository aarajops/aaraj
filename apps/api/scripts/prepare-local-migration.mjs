import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
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
  run("pnpm", ["--filter", "@aaraj/contracts", "run", "build"]);
  run("pnpm", ["run", "build"]);
  run(process.execPath, [converter, "--execute"]);
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
