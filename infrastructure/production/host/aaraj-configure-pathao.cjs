#!/usr/bin/node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseEnv } = require("node:util");

const RUNTIME_ENV_PATH = "/etc/sites/aaraj/runtime.env";
const MAX_RUNTIME_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 32 * 1024;
const PATHAO_KEYS = [
  "PATHAO_BASE_URL",
  "PATHAO_DELIVERY_TYPE",
  "PATHAO_TOKEN_ENCRYPTION_KEY",
  "PATHAO_SANDBOX_CLIENT_ID",
  "PATHAO_SANDBOX_CLIENT_SECRET",
  "PATHAO_SANDBOX_USERNAME",
  "PATHAO_SANDBOX_PASSWORD",
  "PATHAO_SANDBOX_WEBHOOK_SECRET",
  "PATHAO_LIVE_CLIENT_ID",
  "PATHAO_LIVE_CLIENT_SECRET",
  "PATHAO_LIVE_USERNAME",
  "PATHAO_LIVE_PASSWORD",
  "PATHAO_LIVE_WEBHOOK_SECRET",
];
const PATHAO_BASE_URLS = new Map([
  ["https://courier-api-sandbox.pathao.com", "sandbox"],
  ["https://api-hermes.pathao.com", "live"],
]);
const SANDBOX_CREDENTIAL_KEYS = [
  "PATHAO_SANDBOX_CLIENT_ID",
  "PATHAO_SANDBOX_CLIENT_SECRET",
  "PATHAO_SANDBOX_USERNAME",
  "PATHAO_SANDBOX_PASSWORD",
  "PATHAO_SANDBOX_WEBHOOK_SECRET",
];
const LIVE_CREDENTIAL_KEYS = [
  "PATHAO_LIVE_CLIENT_ID",
  "PATHAO_LIVE_CLIENT_SECRET",
  "PATHAO_LIVE_USERNAME",
  "PATHAO_LIVE_PASSWORD",
  "PATHAO_LIVE_WEBHOOK_SECRET",
];
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

  for (const key of entries.keys()) {
    if (!PATHAO_KEYS.includes(key))
      fail(`Configuration payload contains unauthorized key ${key}.`);
  }
  for (const key of PATHAO_KEYS) {
    if (!entries.has(key)) fail(`Configuration payload is missing ${key}.`);
  }

  return entries;
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

function validateDeliveryType(value) {
  if (value !== "48" && value !== "12") {
    fail("PATHAO_DELIVERY_TYPE must be the single documented value 48 or 12.");
  }
}

function pathaoEnvironment(baseUrl) {
  if (!baseUrl) return null;
  const environment = PATHAO_BASE_URLS.get(baseUrl);
  if (!environment) {
    fail("PATHAO_BASE_URL must match Pathao's documented sandbox or live URL.");
  }
  return environment;
}

function validateConfiguration(inputValues, existingValues) {
  const baseUrl = inputValues.get("PATHAO_BASE_URL");
  const mode = pathaoEnvironment(baseUrl);
  const providedKey = inputValues.get("PATHAO_TOKEN_ENCRYPTION_KEY");
  const existingKey = existingValues.get("PATHAO_TOKEN_ENCRYPTION_KEY") || "";
  validateEncryptionKey(existingKey, false);
  validateEncryptionKey(providedKey, false);
  if (existingKey && providedKey && existingKey !== providedKey) {
    fail("PATHAO_TOKEN_ENCRYPTION_KEY must match the existing runtime key.");
  }

  const result = new Map(PATHAO_KEYS.map((key) => [key, ""]));
  result.set("PATHAO_BASE_URL", baseUrl);
  result.set("PATHAO_TOKEN_ENCRYPTION_KEY", existingKey || providedKey || "");

  if (!mode) {
    if (inputValues.get("PATHAO_DELIVERY_TYPE") !== "") {
      fail(
        "PATHAO_DELIVERY_TYPE must be empty when PATHAO_BASE_URL is absent.",
      );
    }
    for (const key of [...SANDBOX_CREDENTIAL_KEYS, ...LIVE_CREDENTIAL_KEYS]) {
      if (inputValues.get(key) !== "") {
        fail(`${key} must be empty when PATHAO_BASE_URL is absent.`);
      }
    }
    return result;
  }

  validateEncryptionKey(existingKey || providedKey, true);
  validateDeliveryType(inputValues.get("PATHAO_DELIVERY_TYPE"));
  result.set("PATHAO_DELIVERY_TYPE", inputValues.get("PATHAO_DELIVERY_TYPE"));

  const selectedCredentialKeys =
    mode === "sandbox" ? SANDBOX_CREDENTIAL_KEYS : LIVE_CREDENTIAL_KEYS;
  const inactiveCredentialKeys =
    mode === "sandbox" ? LIVE_CREDENTIAL_KEYS : SANDBOX_CREDENTIAL_KEYS;
  for (const key of inactiveCredentialKeys) {
    if (inputValues.get(key) !== "")
      fail(`${key} must be empty for the selected PATHAO_BASE_URL.`);
  }
  for (const key of selectedCredentialKeys) {
    const value = inputValues.get(key);
    validateCredential(value, key);
    result.set(key, value);
  }
  return result;
}

function buildPayload(environment) {
  const baseUrl = environment.PATHAO_BASE_URL ?? "";
  const mode = pathaoEnvironment(baseUrl);

  const values = new Map(PATHAO_KEYS.map((key) => [key, ""]));
  values.set("PATHAO_BASE_URL", baseUrl);
  values.set(
    "PATHAO_TOKEN_ENCRYPTION_KEY",
    environment.PATHAO_TOKEN_ENCRYPTION_KEY ?? "",
  );
  values.set(
    "PATHAO_DELIVERY_TYPE",
    mode ? (environment.PATHAO_DELIVERY_TYPE ?? "") : "",
  );
  if (mode === "sandbox") {
    for (const key of SANDBOX_CREDENTIAL_KEYS) {
      values.set(key, environment[key] ?? "");
    }
  } else if (mode === "live") {
    for (const key of LIVE_CREDENTIAL_KEYS) {
      values.set(key, environment[key] ?? "");
    }
  }
  for (const [key, value] of values) {
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
      fail(`Configuration value ${key} contains unsafe content.`);
    }
  }
  validateConfiguration(values, new Map());
  return `${PATHAO_KEYS.map((key) => `${key}=${values.get(key)}`).join("\n")}\n`;
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
  for (const key of desiredValues.keys()) {
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

function samePathaoValues(currentValues, desiredValues) {
  for (const [key, value] of currentValues) {
    if (
      key.startsWith("PATHAO_") &&
      (desiredValues.has(key) ? desiredValues.get(key) : null) !== value
    ) {
      return false;
    }
  }
  for (const [key, value] of desiredValues) {
    if ((currentValues.has(key) ? currentValues.get(key) : null) !== value) {
      return false;
    }
  }
  return true;
}

function applyConfiguration({
  runtimeEnvPath,
  values,
  renameFile,
}) {
  const runtime = readRegularFile(runtimeEnvPath, "Runtime environment file");
  const parsed = parseRuntimeEnv(runtime.contents);
  const desired = validateConfiguration(values, parsed.values);

  if (samePathaoValues(parsed.values, desired)) return "already-applied";
  const nextContents = rewriteRuntimeEnv(runtime.contents, desired);
  atomicWrite(runtimeEnvPath, nextContents, {
    mode: 0o640,
    uid: runtime.stat.uid,
    gid: runtime.stat.gid,
    renameFile,
  });
  return "applied";
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
  const values = parsePayload(await readStdin());
  const result = applyConfiguration({
    runtimeEnvPath: RUNTIME_ENV_PATH,
    values,
  });
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
};
