#!/usr/bin/node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseEnv } = require("node:util");

const RUNTIME_ENV_PATH = "/etc/sites/aaraj/runtime.env";
const BACKUP_PATH = "/etc/sites/aaraj/.runtime.env.pathao-backup";
const MAX_RUNTIME_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 32 * 1024;
const RELEASE_SHA = /^[0-9a-f]{40}$/;
const PATHAO_KEYS = [
  "PATHAO_MODE",
  "PATHAO_TOKEN_ENCRYPTION_KEY",
  "PATHAO_SANDBOX_CLIENT_ID",
  "PATHAO_SANDBOX_CLIENT_SECRET",
  "PATHAO_SANDBOX_USERNAME",
  "PATHAO_SANDBOX_PASSWORD",
  "PATHAO_SANDBOX_WEBHOOK_SECRET",
  "PATHAO_SANDBOX_APPROVED_STORE_IDS",
  "PATHAO_LIVE_CLIENT_ID",
  "PATHAO_LIVE_CLIENT_SECRET",
  "PATHAO_LIVE_USERNAME",
  "PATHAO_LIVE_PASSWORD",
  "PATHAO_LIVE_WEBHOOK_SECRET",
  "PATHAO_LIVE_APPROVED_STORE_IDS",
  "PATHAO_LIVE_CREDENTIALS_ROTATED",
  "PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED",
];
const MANAGED_PATHAO_KEYS = PATHAO_KEYS;
const SANDBOX_CREDENTIAL_KEYS = [
  "PATHAO_SANDBOX_CLIENT_ID",
  "PATHAO_SANDBOX_CLIENT_SECRET",
  "PATHAO_SANDBOX_USERNAME",
  "PATHAO_SANDBOX_PASSWORD",
  "PATHAO_SANDBOX_WEBHOOK_SECRET",
];
const SANDBOX_ALLOWLIST_KEYS = ["PATHAO_SANDBOX_APPROVED_STORE_IDS"];
const LIVE_KEYS = PATHAO_KEYS.filter(
  (key) =>
    key.startsWith("PATHAO_LIVE_") ||
    key === "PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED",
);

function fail(message) {
  throw new Error(message);
}

function parsePayload(input) {
  if (
    typeof input !== "string" ||
    Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES
  ) {
    fail("Configuration payload is missing or too large.");
  }
  if (!input.endsWith("\n") || /[\r\0]/.test(input)) {
    fail("Configuration payload has invalid line endings.");
  }

  const entries = new Map();
  for (const line of input.slice(0, -1).split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1)
      fail("Configuration payload contains a malformed entry.");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      fail("Configuration payload contains an invalid key.");
    if (entries.has(key))
      fail(`Configuration payload contains duplicate key ${key}.`);
    if (/[\r\n\0]/.test(value))
      fail(`Configuration value ${key} contains unsafe content.`);
    entries.set(key, value);
  }

  const operation = entries.get("operation");
  const release = entries.get("release");
  if (!["apply", "restore", "commit"].includes(operation))
    fail("Configuration operation is invalid.");
  if (!RELEASE_SHA.test(release || ""))
    fail("Configuration release identifier is invalid.");

  const expected =
    operation === "apply"
      ? new Set(["operation", "release", ...PATHAO_KEYS])
      : new Set(["operation", "release"]);
  for (const key of entries.keys()) {
    if (!expected.has(key))
      fail(`Configuration payload contains unauthorized key ${key}.`);
  }
  for (const key of expected) {
    if (!entries.has(key)) fail(`Configuration payload is missing ${key}.`);
  }

  return { operation, release, values: entries };
}

function parseRuntimeEnv(contents) {
  if (
    typeof contents !== "string" ||
    Buffer.byteLength(contents, "utf8") > MAX_RUNTIME_BYTES
  ) {
    fail("Runtime environment file is missing or too large.");
  }
  if (/[\r\0]/.test(contents))
    fail("Runtime environment file contains invalid characters.");

  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const records = [];
  const values = new Map();

  for (const raw of lines) {
    if (raw.trim() === "" || /^\s*#/.test(raw)) {
      records.push({ raw, key: null });
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw);
    if (!match) fail("Runtime environment file contains a malformed entry.");
    const [, key] = match;
    if (values.has(key))
      fail(`Runtime environment file contains duplicate key ${key}.`);
    if (key.startsWith("PATHAO_") && !MANAGED_PATHAO_KEYS.includes(key)) {
      fail(`Runtime environment file contains unauthorized key ${key}.`);
    }
    let parsed;
    try {
      parsed = parseEnv(raw);
    } catch {
      fail(`Runtime environment entry ${key} is malformed.`);
    }
    if (!Object.hasOwn(parsed, key))
      fail(`Runtime environment entry ${key} is malformed.`);
    const value = parsed[key];
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
      fail(`Runtime environment entry ${key} contains unsafe content.`);
    }
    if (key.startsWith("PATHAO_") && /[\x00-\x1f\x7f']/.test(value)) {
      fail(`Runtime environment entry ${key} cannot be safely rewritten.`);
    }
    records.push({ raw, key });
    values.set(key, value);
  }

  return { records, values };
}

function validateCredential(value, name) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 4096
  ) {
    fail(`${name} must be configured.`);
  }
  // The runtime file is parsed as Node dotenv data, never sourced by a shell.
  // Single quotes preserve shell-looking characters literally; apostrophes and
  // control bytes are rejected because this env-file format cannot represent them.
  if (/[\x00-\x1f\x7f']/.test(value))
    fail(`${name} contains unsupported characters.`);
}

function validateEncryptionKey(value, required) {
  if (!value) {
    if (required) fail("PATHAO_TOKEN_ENCRYPTION_KEY must be configured.");
    return;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    fail(
      "PATHAO_TOKEN_ENCRYPTION_KEY must be canonical base64url for 32 random bytes.",
    );
  }
}

function validateStoreIds(value) {
  if (!value || !/^[1-9][0-9]*(,[1-9][0-9]*)*$/.test(value)) {
    fail(
      "PATHAO_SANDBOX_APPROVED_STORE_IDS must be a nonempty comma-separated list of positive IDs.",
    );
  }
  const ids = value.split(",");
  if (
    ids.some((id) => Number(id) > 2_147_483_647) ||
    new Set(ids).size !== ids.length
  ) {
    fail(
      "PATHAO_SANDBOX_APPROVED_STORE_IDS contains an invalid or duplicate ID.",
    );
  }
}

function validateConfiguration(inputValues, existingValues) {
  const mode = inputValues.get("PATHAO_MODE");
  if (mode === "live")
    fail("Pathao live mode is blocked by the provisioning helper.");
  if (mode !== "disabled" && mode !== "sandbox") {
    fail("PATHAO_MODE must be explicitly disabled or sandbox.");
  }

  const providedKey = inputValues.get("PATHAO_TOKEN_ENCRYPTION_KEY");
  const existingKey = existingValues.get("PATHAO_TOKEN_ENCRYPTION_KEY") || "";
  if (mode === "sandbox") validateEncryptionKey(existingKey, false);
  validateEncryptionKey(providedKey, mode === "sandbox");
  if (existingKey && providedKey && existingKey !== providedKey) {
    fail(
      "PATHAO_TOKEN_ENCRYPTION_KEY replacement is blocked; use an approved rotation procedure.",
    );
  }
  if (mode === "sandbox" && existingKey && providedKey !== existingKey) {
    fail("PATHAO_TOKEN_ENCRYPTION_KEY must match the existing runtime key.");
  }

  for (const key of LIVE_KEYS) {
    const isApprovalFlag =
      key === "PATHAO_LIVE_CREDENTIALS_ROTATED" ||
      key === "PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED";
    if (inputValues.get(key) !== (isApprovalFlag ? "false" : "")) {
      fail(`${key} must remain empty or false while live mode is blocked.`);
    }
  }
  if (
    inputValues.get("PATHAO_LIVE_CREDENTIALS_ROTATED") !== "false" ||
    inputValues.get("PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED") !== "false"
  ) {
    fail("Pathao live approval flags must remain false.");
  }

  const result = new Map(PATHAO_KEYS.map((key) => [key, ""]));
  result.set("PATHAO_MODE", mode);
  result.set("PATHAO_TOKEN_ENCRYPTION_KEY", existingKey || providedKey || "");
  result.set("PATHAO_LIVE_CREDENTIALS_ROTATED", "false");
  result.set("PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED", "false");

  if (mode === "disabled") {
    for (const key of [...SANDBOX_CREDENTIAL_KEYS, ...SANDBOX_ALLOWLIST_KEYS]) {
      if (inputValues.get(key) !== "")
        fail(`${key} must be empty while PATHAO_MODE is disabled.`);
    }
    return result;
  }

  for (const key of SANDBOX_CREDENTIAL_KEYS) {
    const value = inputValues.get(key);
    validateCredential(value, key);
    result.set(key, value);
  }
  validateStoreIds(inputValues.get("PATHAO_SANDBOX_APPROVED_STORE_IDS"));
  for (const key of SANDBOX_ALLOWLIST_KEYS)
    result.set(key, inputValues.get(key));
  return result;
}

function buildPayload(environment, release) {
  if (!RELEASE_SHA.test(release || ""))
    fail("Configuration release identifier is invalid.");
  const mode = environment.PATHAO_MODE ?? "";
  if (mode !== "disabled" && mode !== "sandbox") {
    fail("PATHAO_MODE must be explicitly disabled or sandbox.");
  }

  const values = new Map(PATHAO_KEYS.map((key) => [key, ""]));
  values.set("PATHAO_MODE", mode);
  values.set(
    "PATHAO_TOKEN_ENCRYPTION_KEY",
    environment.PATHAO_TOKEN_ENCRYPTION_KEY ?? "",
  );
  if (mode === "sandbox") {
    for (const key of [...SANDBOX_CREDENTIAL_KEYS, ...SANDBOX_ALLOWLIST_KEYS]) {
      values.set(key, environment[key] ?? "");
    }
  }
  values.set("PATHAO_LIVE_CREDENTIALS_ROTATED", "false");
  values.set("PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED", "false");
  for (const [key, value] of values) {
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
      fail(`Configuration value ${key} contains unsafe content.`);
    }
  }
  validateConfiguration(values, new Map());
  return [
    "operation=apply",
    `release=${release}`,
    ...PATHAO_KEYS.map((key) => `${key}=${values.get(key)}`),
    "",
  ].join("\n");
}

function encodeEnvValue(value) {
  if (typeof value !== "string" || /[\r\n\0']/.test(value)) {
    fail(
      "Pathao configuration cannot be represented safely in the runtime environment file.",
    );
  }
  return value === "" ? "" : `'${value}'`;
}

function rewriteRuntimeEnv(contents, desiredValues) {
  const { records } = parseRuntimeEnv(contents);
  const written = new Set();
  const output = [];
  for (const record of records) {
    if (!record.key?.startsWith("PATHAO_")) {
      output.push(record.raw);
      continue;
    }
    if (!desiredValues.has(record.key)) continue;
    const desired = desiredValues.get(record.key);
    if (desired === null) continue;
    output.push(`${record.key}=${encodeEnvValue(desired)}`);
    written.add(record.key);
  }
  for (const key of MANAGED_PATHAO_KEYS) {
    if (
      desiredValues.has(key) &&
      desiredValues.get(key) !== null &&
      !written.has(key)
    ) {
      output.push(`${key}=${encodeEnvValue(desiredValues.get(key))}`);
    }
  }
  return `${output.join("\n")}\n`;
}

function readRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    fail(`${label} is missing or inaccessible.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    fail(
      `${label} must be a single-link regular file, not a symlink or hard link.`,
    );
  try {
    return {
      contents: new TextDecoder("utf-8", { fatal: true }).decode(
        fs.readFileSync(filePath),
      ),
      stat,
    };
  } catch {
    fail(`${label} is not valid UTF-8.`);
  }
}

function pathExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail("Pathao rollback snapshot is inaccessible.");
  }
}

function atomicWrite(
  filePath,
  contents,
  { mode, uid, gid, renameFile = fs.renameSync },
) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
    fs.fchownSync(descriptor, uid, gid);
    fs.fchmodSync(descriptor, mode);
    fs.closeSync(descriptor);
    descriptor = undefined;
    renameFile(tempPath, filePath);
    const directoryFd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } catch {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* no temporary file remains */
    }
    fail("Atomic runtime configuration update failed.");
  }
}

function pathaoSnapshot(values) {
  return Object.fromEntries(
    MANAGED_PATHAO_KEYS.map((key) => [
      key,
      values.has(key) ? values.get(key) : null,
    ]),
  );
}

function parseBackup(filePath, release) {
  const { contents, stat } = readRegularFile(
    filePath,
    "Pathao rollback snapshot",
  );
  if ((stat.mode & 0o7777) !== 0o600)
    fail("Pathao rollback snapshot permissions are invalid.");
  let snapshot;
  try {
    snapshot = JSON.parse(contents);
  } catch {
    fail("Pathao rollback snapshot is malformed.");
  }
  if (
    snapshot?.version !== 1 ||
    snapshot.release !== release ||
    !snapshot.values ||
    typeof snapshot.values !== "object" ||
    Array.isArray(snapshot.values)
  ) {
    fail("Pathao rollback snapshot does not match this release.");
  }
  const keys = Object.keys(snapshot.values);
  if (
    keys.length !== MANAGED_PATHAO_KEYS.length ||
    keys.some((key) => !MANAGED_PATHAO_KEYS.includes(key))
  ) {
    fail("Pathao rollback snapshot contains unauthorized keys.");
  }
  for (const value of Object.values(snapshot.values)) {
    if (
      value !== null &&
      (typeof value !== "string" || /[\x00-\x1f\x7f']/.test(value))
    ) {
      fail("Pathao rollback snapshot contains invalid values.");
    }
  }
  return snapshot;
}

function samePathaoValues(currentValues, desiredValues) {
  return MANAGED_PATHAO_KEYS.every(
    (key) => (currentValues.get(key) ?? "") === (desiredValues.get(key) ?? ""),
  );
}

function applyConfiguration({
  runtimeEnvPath,
  backupPath,
  release,
  values,
  backupOwner,
  renameFile,
}) {
  const runtime = readRegularFile(runtimeEnvPath, "Runtime environment file");
  const parsed = parseRuntimeEnv(runtime.contents);
  const desired = validateConfiguration(values, parsed.values);

  if (pathExists(backupPath)) {
    const snapshot = parseBackup(backupPath, release);
    const original = new Map(
      Object.entries(snapshot.values).filter(([, value]) => value !== null),
    );
    if (samePathaoValues(parsed.values, desired)) return "already-applied";
    if (!samePathaoValues(parsed.values, original)) {
      fail("A different Pathao configuration transaction is still pending.");
    }
    const nextContents = rewriteRuntimeEnv(runtime.contents, desired);
    atomicWrite(runtimeEnvPath, nextContents, {
      mode: 0o640,
      uid: runtime.stat.uid,
      gid: runtime.stat.gid,
      renameFile,
    });
    return "applied";
  }

  const snapshot = {
    version: 1,
    release,
    values: pathaoSnapshot(parsed.values),
  };
  const owner = backupOwner || { uid: runtime.stat.uid, gid: runtime.stat.gid };
  atomicWrite(backupPath, `${JSON.stringify(snapshot)}\n`, {
    mode: 0o600,
    uid: owner.uid,
    gid: owner.gid,
    renameFile,
  });
  try {
    const nextContents = rewriteRuntimeEnv(runtime.contents, desired);
    atomicWrite(runtimeEnvPath, nextContents, {
      mode: 0o640,
      uid: runtime.stat.uid,
      gid: runtime.stat.gid,
      renameFile,
    });
  } catch (error) {
    try {
      if (fs.readFileSync(runtimeEnvPath, "utf8") === runtime.contents)
        fs.unlinkSync(backupPath);
    } catch {
      // Retain a recoverable snapshot if the result of the atomic rename is uncertain.
    }
    throw error;
  }
  return "applied";
}

function restoreConfiguration({
  runtimeEnvPath,
  backupPath,
  release,
  renameFile,
}) {
  if (!pathExists(backupPath)) return "nothing-to-restore";
  const snapshot = parseBackup(backupPath, release);
  const runtime = readRegularFile(runtimeEnvPath, "Runtime environment file");
  parseRuntimeEnv(runtime.contents);
  const previous = new Map(Object.entries(snapshot.values));
  const nextContents = rewriteRuntimeEnv(runtime.contents, previous);
  atomicWrite(runtimeEnvPath, nextContents, {
    mode: 0o640,
    uid: runtime.stat.uid,
    gid: runtime.stat.gid,
    renameFile,
  });
  fs.unlinkSync(backupPath);
  return "restored";
}

function commitConfiguration({ backupPath, release }) {
  if (!pathExists(backupPath)) return "nothing-to-commit";
  parseBackup(backupPath, release);
  fs.unlinkSync(backupPath);
  return "committed";
}

function readGroupId(name) {
  const groups = fs.readFileSync("/etc/group", "utf8").split("\n");
  for (const row of groups) {
    const parts = row.split(":");
    if (parts[0] === name && /^[0-9]+$/.test(parts[2] || ""))
      return Number(parts[2]);
  }
  fail("Required AARAJ runtime group is missing.");
}

function assertProductionFiles() {
  if (process.getuid() !== 0) fail("Pathao runtime helper must run as root.");
  const directoryParts = path
    .dirname(RUNTIME_ENV_PATH)
    .split(path.sep)
    .filter(Boolean);
  let directory = path.parse(RUNTIME_ENV_PATH).root;
  for (const part of directoryParts) {
    directory = path.join(directory, part);
    const dirStat = fs.lstatSync(directory);
    if (
      !dirStat.isDirectory() ||
      dirStat.isSymbolicLink() ||
      dirStat.uid !== 0 ||
      (dirStat.mode & 0o022) !== 0
    ) {
      fail("Runtime configuration directory is unsafe.");
    }
  }
  const runtime = readRegularFile(RUNTIME_ENV_PATH, "Runtime environment file");
  if (
    runtime.stat.uid !== 0 ||
    runtime.stat.gid !== readGroupId("aaraj") ||
    (runtime.stat.mode & 0o7777) !== 0o640
  ) {
    fail("Runtime environment ownership or permissions are invalid.");
  }
  if (pathExists(BACKUP_PATH)) {
    const backup = readRegularFile(BACKUP_PATH, "Pathao rollback snapshot");
    if (
      backup.stat.uid !== 0 ||
      backup.stat.gid !== 0 ||
      (backup.stat.mode & 0o7777) !== 0o600
    ) {
      fail("Pathao rollback snapshot ownership or permissions are invalid.");
    }
  }
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) fail("Configuration payload is too large.");
    chunks.push(chunk);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    fail("Configuration payload is not valid UTF-8.");
  }
}

async function main() {
  if (process.argv.length !== 2)
    fail("This helper accepts configuration only on stdin.");
  assertProductionFiles();
  const payload = parsePayload(await readStdin());
  let result;
  if (payload.operation === "apply") {
    result = applyConfiguration({
      runtimeEnvPath: RUNTIME_ENV_PATH,
      backupPath: BACKUP_PATH,
      release: payload.release,
      values: payload.values,
      backupOwner: { uid: 0, gid: 0 },
    });
  } else if (payload.operation === "restore") {
    result = restoreConfiguration({
      runtimeEnvPath: RUNTIME_ENV_PATH,
      backupPath: BACKUP_PATH,
      release: payload.release,
    });
  } else {
    result = commitConfiguration({
      backupPath: BACKUP_PATH,
      release: payload.release,
    });
  }
  process.stdout.write(`Pathao runtime configuration ${result}.\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error.message || "Pathao runtime configuration failed."}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  PATHAO_KEYS,
  parsePayload,
  parseRuntimeEnv,
  validateConfiguration,
  buildPayload,
  rewriteRuntimeEnv,
  applyConfiguration,
  restoreConfiguration,
  commitConfiguration,
};
