import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const options = parseArguments(process.argv.slice(2));
const nodeVersion = (
  await readFile(path.join(repository, ".node-version"), "utf8")
).trim();
const pnpmVersion = "12.5.1";

if (!/^v\d+\.\d+\.\d+$/.test(options.tag ?? "")) {
  throw new Error("--tag must be a stable vX.Y.Z release tag.");
}
if (!/^[0-9a-f]{40}$/i.test(options.commit ?? "")) {
  throw new Error("--commit must be a full Git commit SHA.");
}
if (!options.output) throw new Error("--out-dir is required.");
options.operation ??= "release";
if (
  !["release", "delivery-district-delete-grant"].includes(options.operation)
) {
  throw new Error("--operation must be a supported release operation.");
}
if (
  process.version !== `v${nodeVersion}` ||
  command("pnpm", ["--version"]) !== pnpmVersion
) {
  throw new Error(
    `Release builds require Node.js ${nodeVersion} and pnpm ${pnpmVersion}.`,
  );
}
if (command("git", ["rev-parse", "HEAD"]) !== options.commit) {
  throw new Error("The checked-out commit does not match --commit.");
}

const dirty = Boolean(
  command("git", ["status", "--porcelain", "--untracked-files=all"]),
);
if (dirty && !options.allowDirty) {
  throw new Error(
    "Production release packaging requires a clean Git worktree.",
  );
}

const output = path.resolve(options.output);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length > 0) {
  throw new Error(`Refusing to overwrite files in ${output}.`);
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "aaraj-release-"));
const stage = path.join(temporary, "stage");
const apiDeploy = path.join(temporary, "api-deploy");
const releaseApi = path.join(stage, "api");
const releaseWeb = path.join(stage, "web");

try {
  await mkdir(stage);
  command("pnpm", ["--filter", "@aaraj/contracts", "run", "build"]);
  command("pnpm", ["--filter", "@aaraj/api", "run", "build"]);
  command("pnpm", ["--filter", "@aaraj/web", "run", "build"], {
    API_INTERNAL_URL: "http://127.0.0.1:3001",
    CLIENT_URL: "https://aaraj.invalid",
    RELEASE_COMMIT_SHA: options.commit,
  });
  command("pnpm", ["--filter", "@aaraj/api", "deploy", "--prod", apiDeploy]);

  await mkdir(releaseApi);
  await cp(
    path.join(apiDeploy, "node_modules"),
    path.join(releaseApi, "node_modules"),
    {
      recursive: true,
      verbatimSymlinks: true,
    },
  );
  await cp(
    path.join(repository, "apps/api/package.json"),
    path.join(releaseApi, "package.json"),
  );
  await cp(
    path.join(repository, "apps/api/dist"),
    path.join(releaseApi, "dist"),
    {
      recursive: true,
    },
  );
  await cp(
    path.join(repository, "apps/api/drizzle"),
    path.join(releaseApi, "drizzle"),
    {
      recursive: true,
    },
  );
  await mkdir(path.join(releaseApi, "scripts"));
  await cp(
    path.join(repository, "apps/api/scripts/migrate-production.mjs"),
    path.join(releaseApi, "scripts/migrate-production.mjs"),
  );

  const standalone = path.join(repository, "apps/web/.next/standalone");
  const serverCandidates = [];
  for (const entry of ["apps/web/server.js", "server.js"]) {
    if (await exists(path.join(standalone, entry)))
      serverCandidates.push(entry);
  }
  if (serverCandidates.length !== 1) {
    throw new Error(
      `Expected one Next.js standalone server; found ${serverCandidates.length}.`,
    );
  }
  const serverEntry = serverCandidates[0];
  const webEntryDirectory = path.posix.dirname(serverEntry);
  await cp(standalone, releaseWeb, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const webRoot = path.join(repository, "apps/web");
  await cp(
    path.join(webRoot, ".next/static"),
    path.join(releaseWeb, webEntryDirectory, ".next/static"),
    { recursive: true },
  );
  const publicDirectory = path.join(webRoot, "public");
  if (await exists(publicDirectory)) {
    await cp(
      publicDirectory,
      path.join(releaseWeb, webEntryDirectory, "public"),
      {
        recursive: true,
      },
    );
  } else {
    await mkdir(path.join(releaseWeb, webEntryDirectory, "public"), {
      recursive: true,
    });
  }

  const contracts = await realpath(
    path.join(releaseApi, "node_modules/@aaraj/contracts"),
  );
  if (!contracts.startsWith(`${releaseApi}${path.sep}`)) {
    throw new Error(
      "The deployed API contracts package escapes its release directory.",
    );
  }

  const manifest = {
    schemaVersion: 1,
    application: "aaraj",
    releaseTag: options.tag,
    commit: options.commit.toLowerCase(),
    dirty,
    operation: options.operation,
    nodeVersion,
    pnpmVersion,
    lockfileSha256: sha256(
      await readFile(path.join(repository, "pnpm-lock.yaml")),
    ),
    api: {
      entrypoint: "api/dist/main.js",
      migrationEntrypoint: "api/scripts/migrate-production.mjs",
    },
    web: {
      serverEntrypoint: `web/${serverEntry}`,
      staticDirectory: `web/${webEntryDirectory}/.next/static`,
      publicDirectory: `web/${webEntryDirectory}/public`,
      apiOrigin: "http://127.0.0.1:3001",
    },
    runner: {
      os: "ubuntu-24.04",
      platform: process.platform,
      architecture: process.arch,
    },
  };

  await writeFile(
    path.join(stage, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const archive = path.join(output, "aaraj-release.tar.gz");
  const tar = spawnSync(
    "bash",
    [
      "-euo",
      "pipefail",
      "-c",
      'export LC_ALL=C; tar --sort=name --mtime="UTC 1970-01-01" --owner=0 --group=0 --numeric-owner -cf - -C "$1" . | gzip -n -9 > "$2"',
      "bash",
      stage,
      archive,
    ],
    { cwd: repository, stdio: "inherit" },
  );
  if (tar.status !== 0)
    throw new Error("Could not create the release archive.");

  const digest = sha256(await readFile(archive));
  await writeFile(
    path.join(output, "aaraj-release.tar.gz.sha256"),
    `${digest}  aaraj-release.tar.gz\n`,
  );
  process.stdout.write(
    `Built AARAJ ${options.tag} (${manifest.commit}); SHA-256 ${digest}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-dirty") parsed.allowDirty = true;
    else if (
      ["--tag", "--commit", "--out-dir", "--operation"].includes(argument)
    ) {
      parsed[
        {
          "--tag": "tag",
          "--commit": "commit",
          "--out-dir": "output",
          "--operation": "operation",
        }[argument]
      ] = args[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return parsed;
}

function command(name, args, environment = {}) {
  const result = spawnSync(name, args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...environment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} ${args.join(" ")} failed.`);
  return result.stdout.trim();
}

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
