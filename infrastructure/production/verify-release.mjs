import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const options = parseArguments(process.argv.slice(2));
const archive = path.resolve(options.archive ?? "");
if (!options.archive) throw new Error("--archive is required.");

const digest = hash(await readFile(archive));
const expectedDigest = (await readFile(`${archive}.sha256`, "utf8"))
  .trim()
  .split(/\s+/)[0];
if (digest !== expectedDigest)
  throw new Error("The release archive checksum does not match.");

const temporary = await mkdtemp(path.join(os.tmpdir(), "aaraj-verify-"));
const extracted = path.join(temporary, "release");
await mkdir(extracted);

try {
  run("python3", [
    "-c",
    "import sys, tarfile; archive = tarfile.open(sys.argv[1], 'r:gz'); archive.extractall(path=sys.argv[2], filter='data')",
    archive,
    extracted,
  ]);

  const manifest = JSON.parse(
    await readFile(path.join(extracted, "release-manifest.json"), "utf8"),
  );
  const expectedNode = (
    await readFile(path.join(repository, ".node-version"), "utf8")
  ).trim();
  const webDirectory = manifest.web?.serverEntrypoint?.startsWith("web/")
    ? path.posix.dirname(manifest.web.serverEntrypoint.slice("web/".length))
    : "";
  if (
    manifest.schemaVersion !== 1 ||
    manifest.application !== "aaraj" ||
    (manifest.dirty !== false && !options.allowDirty) ||
    manifest.nodeVersion !== expectedNode ||
    manifest.pnpmVersion !== "12.5.1" ||
    !["release", "delivery-district-delete-grant"].includes(
      manifest.operation ?? "release",
    ) ||
    (options.operation &&
      (manifest.operation ?? "release") !== options.operation) ||
    manifest.lockfileSha256 !==
      hash(await readFile(path.join(repository, "pnpm-lock.yaml"))) ||
    !/^v\d+\.\d+\.\d+$/.test(manifest.releaseTag) ||
    !/^[0-9a-f]{40}$/.test(manifest.commit) ||
    (options.commit && manifest.commit !== options.commit) ||
    (options.tag && manifest.releaseTag !== options.tag) ||
    manifest.api?.entrypoint !== "api/dist/main.js" ||
    manifest.api?.migrationEntrypoint !==
      "api/scripts/migrate-production.mjs" ||
    !["web/apps/web/server.js", "web/server.js"].includes(
      manifest.web?.serverEntrypoint,
    ) ||
    manifest.web?.staticDirectory !== "web/" + webDirectory + "/.next/static" ||
    manifest.web?.publicDirectory !== "web/" + webDirectory + "/public" ||
    manifest.web?.apiOrigin !== "http://127.0.0.1:3001" ||
    manifest.runner?.os !== "ubuntu-24.04" ||
    manifest.runner?.platform !== "linux" ||
    manifest.runner?.architecture !== "x64"
  ) {
    throw new Error(
      "The release manifest does not match the approved source and toolchain.",
    );
  }

  await verifyRuntimeFiles(extracted, manifest);
  if (options.smoke) await smokeRelease(extracted, manifest);
  process.stdout.write(
    `Verified AARAJ ${manifest.releaseTag} (${manifest.commit}); SHA-256 ${digest}; smoke=${Boolean(options.smoke)}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function parseArguments(args) {
  const parsed = { smoke: false, allowDirty: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--smoke") parsed.smoke = true;
    else if (argument === "--allow-dirty") parsed.allowDirty = true;
    else if (
      ["--archive", "--commit", "--tag", "--operation"].includes(argument)
    ) {
      parsed[
        {
          "--archive": "archive",
          "--commit": "commit",
          "--tag": "tag",
          "--operation": "operation",
        }[argument]
      ] = args[++index];
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

async function verifyRuntimeFiles(root, manifest) {
  for (const relative of [
    manifest.api.entrypoint,
    manifest.api.migrationEntrypoint,
    "api/drizzle/meta/_journal.json",
    manifest.web.serverEntrypoint,
    manifest.web.staticDirectory,
    manifest.web.publicDirectory,
  ]) {
    if (
      typeof relative !== "string" ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((part) => part === "..")
    ) {
      throw new Error(`Invalid path in the release manifest: ${relative}`);
    }
    await lstat(path.join(root, relative));
  }

  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await import('@aaraj/contracts'); await import('pg'); await import('drizzle-orm/node-postgres'); await import('sharp');",
    ],
    { cwd: path.join(root, "api") },
  );
  run(process.execPath, [
    "--check",
    path.join(root, manifest.api.migrationEntrypoint),
  ]);
  run(process.execPath, [
    "--check",
    path.join(root, manifest.web.serverEntrypoint),
  ]);
}

async function smokeRelease(root, manifest) {
  const apiDirectory = path.join(root, "api");
  const webEntry = path.join(root, manifest.web.serverEntrypoint);
  const webDirectory = path.dirname(webEntry);
  const postgres = {
    host: process.env.E2E_POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.E2E_POSTGRES_PORT ?? 5432),
    database: process.env.E2E_POSTGRES_DATABASE ?? "aaraj_smoke",
    user: process.env.E2E_POSTGRES_USER ?? "aaraj_smoke",
    password: process.env.E2E_POSTGRES_PASSWORD ?? "aaraj_smoke",
  };
  const redisUrl = process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379/14";
  const { drizzle } = await import(
    pathToFileURL(
      path.join(
        apiDirectory,
        "node_modules/drizzle-orm/node-postgres/index.js",
      ),
    )
  );
  const { migrate } = await import(
    pathToFileURL(
      path.join(
        apiDirectory,
        "node_modules/drizzle-orm/node-postgres/migrator.js",
      ),
    )
  );
  const pg = await import(
    pathToFileURL(path.join(apiDirectory, "node_modules/pg/lib/index.js"))
  );
  const pool = new (pg.Pool ?? pg.default.Pool)(postgres);
  const children = [];

  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.join(apiDirectory, "drizzle"),
    });
    const commonEnvironment = {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      POSTGRES_HOST: postgres.host,
      POSTGRES_PORT: String(postgres.port),
      POSTGRES_DB: postgres.database,
      POSTGRES_USER: postgres.user,
      POSTGRES_PASSWORD: postgres.password,
      REDIS_URL: redisUrl,
      BETTER_AUTH_SECRET: "artifact-smoke-only-secret-with-at-least-32-bytes",
      BETTER_AUTH_URL: "http://127.0.0.1:3001",
      CLIENT_URL: "https://aaraj.invalid",
      ORDER_PII_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
      BETTER_AUTH_REDIS_KEY_PREFIX: "aaraj:artifact-smoke:auth:",
      CART_REDIS_KEY_PREFIX: "aaraj:artifact-smoke:cart:",
      THROTTLER_REDIS_KEY_PREFIX: "aaraj:artifact-smoke:throttler:",
      CATALOG_CACHE_KEY_PREFIX: "aaraj:artifact-smoke:catalog:",
    };
    const api = spawn(
      process.execPath,
      [manifest.api.entrypoint.replace("api/", "")],
      {
        cwd: apiDirectory,
        env: { ...commonEnvironment, PORT: "3001" },
        stdio: "inherit",
      },
    );
    children.push(api);
    await waitForHttp(api, "http://127.0.0.1:3001/api/health/ready");

    const web = spawn(process.execPath, [webEntry], {
      cwd: webDirectory,
      env: {
        ...commonEnvironment,
        NODE_ENV: "production",
        API_INTERNAL_URL: manifest.web.apiOrigin,
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
      },
      stdio: "inherit",
    });
    children.push(web);
    await waitForHttp(web, "http://127.0.0.1:3000/");
    const response = await fetch("http://127.0.0.1:3000/api/health/ready");
    if (!response.ok)
      throw new Error(
        `The storefront API rewrite returned HTTP ${response.status}.`,
      );
    const readiness = await response.json();
    if (
      readiness.status !== "ok" ||
      readiness.database !== "ok" ||
      readiness.redis !== "ok"
    ) {
      throw new Error(
        "The packaged API did not report PostgreSQL and Redis readiness.",
      );
    }
  } finally {
    await pool.end();
    await Promise.all(children.map(stopChild));
  }
}

async function waitForHttp(child, url) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Health-check process exited with ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`,
  );
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed.`);
  return result.stdout.trim();
}

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
