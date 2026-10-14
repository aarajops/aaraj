"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseEnv } = require("node:util");

const {
  PATHAO_KEYS,
  applyConfiguration,
  buildPayload,
  commitConfiguration,
  parsePayload,
  restoreConfiguration,
} = require("./aaraj-configure-pathao.cjs");

const RELEASE = "a".repeat(40);
const TOKEN_KEY = crypto.randomBytes(32).toString("base64url");
const CLIENT_SECRET = "dummy-client-secret-123";
const DUMMY_CREDENTIALS = {
  PATHAO_SANDBOX_CLIENT_ID: "dummy-client-id",
  PATHAO_SANDBOX_CLIENT_SECRET: CLIENT_SECRET,
  PATHAO_SANDBOX_USERNAME: "ops@example.invalid",
  PATHAO_SANDBOX_PASSWORD: "dummy-password-456",
  PATHAO_SANDBOX_WEBHOOK_SECRET: "dummy-webhook-secret-789",
  PATHAO_SANDBOX_APPROVED_STORE_IDS: "101,202",
};

function configuration(mode = "sandbox", overrides = {}) {
  const values = new Map(PATHAO_KEYS.map((key) => [key, ""]));
  values.set("PATHAO_MODE", mode);
  values.set(
    "PATHAO_TOKEN_ENCRYPTION_KEY",
    mode === "sandbox" ? TOKEN_KEY : "",
  );
  values.set("PATHAO_LIVE_CREDENTIALS_ROTATED", "false");
  values.set("PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED", "false");
  if (mode === "sandbox") {
    for (const [key, value] of Object.entries(DUMMY_CREDENTIALS))
      values.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) values.set(key, value);
  return values;
}

function payload(operation, release = RELEASE, values = configuration()) {
  const lines = [`operation=${operation}`, `release=${release}`];
  if (operation === "apply") {
    for (const key of PATHAO_KEYS) lines.push(`${key}=${values.get(key)}`);
  }
  return `${lines.join("\n")}\n`;
}

function fixture(
  t,
  initial = "# Keep this comment\nAPP_NAME=aaraj\nOTHER_SECRET=unrelated-value\n",
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "aaraj-pathao-test-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtimeEnvPath = path.join(directory, "runtime.env");
  const backupPath = path.join(directory, ".runtime.env.pathao-backup");
  fs.writeFileSync(runtimeEnvPath, initial, { mode: 0o640 });
  fs.chmodSync(runtimeEnvPath, 0o640);
  return { directory, runtimeEnvPath, backupPath };
}

function apply(fx, values = configuration(), release = RELEASE, extra = {}) {
  return applyConfiguration({
    runtimeEnvPath: fx.runtimeEnvPath,
    backupPath: fx.backupPath,
    release,
    values,
    ...extra,
  });
}

function runtimeValues(fx) {
  return parseEnv(fs.readFileSync(fx.runtimeEnvPath, "utf8"));
}

test("applies complete sandbox settings atomically and preserves unrelated entries and comments", (t) => {
  const fx = fixture(t);
  const ownerBefore = fs.statSync(fx.runtimeEnvPath);
  const result = apply(fx);
  assert.equal(result, "applied");
  assert.doesNotMatch(result, /dummy|secret/i);
  const contents = fs.readFileSync(fx.runtimeEnvPath, "utf8");
  const env = runtimeValues(fx);
  assert.equal(env.PATHAO_MODE, "sandbox");
  assert.equal(env.PATHAO_SANDBOX_CLIENT_SECRET, CLIENT_SECRET);
  assert.equal(env.PATHAO_TOKEN_ENCRYPTION_KEY, TOKEN_KEY);
  assert.equal(env.PATHAO_SANDBOX_APPROVED_STORE_IDS, "101,202");
  assert.equal(env.PATHAO_LIVE_CLIENT_SECRET, "");
  assert.equal(env.PATHAO_LIVE_CREDENTIALS_ROTATED, "false");
  assert.match(contents, /^# Keep this comment$/m);
  assert.equal(env.APP_NAME, "aaraj");
  assert.equal(env.OTHER_SECRET, "unrelated-value");
  const ownerAfter = fs.statSync(fx.runtimeEnvPath);
  assert.equal(ownerAfter.mode & 0o777, 0o640);
  assert.equal(ownerAfter.uid, ownerBefore.uid);
  assert.equal(ownerAfter.gid, ownerBefore.gid);
  assert.equal(fs.statSync(fx.backupPath).mode & 0o777, 0o600);
  assert.doesNotMatch(
    contents,
    /PATHAO_SANDBOX_CLIENT_SECRET=dummy-client-secret/,
  );
});

test("keeps shell-looking credential text literal in the Node env file", (t) => {
  const fx = fixture(t);
  const literal = "$(touch /tmp/aaraj-pathao-injection-marker);#literal";
  assert.equal(
    apply(
      fx,
      configuration("sandbox", {
        PATHAO_SANDBOX_PASSWORD: literal,
      }),
    ),
    "applied",
  );
  assert.equal(runtimeValues(fx).PATHAO_SANDBOX_PASSWORD, literal);
  const sourced = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; printf %s "$PATHAO_SANDBOX_PASSWORD"',
      "bash",
      fx.runtimeEnvPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(sourced.status, 0, sourced.stderr);
  assert.equal(sourced.stdout, literal);
  assert.equal(fs.existsSync("/tmp/aaraj-pathao-injection-marker"), false);
});

test("rejects unrecognized Pathao runtime keys without changing the file", (t) => {
  const initial = [
    "APP_NAME=aaraj",
    "PATHAO_UNRECOGNIZED_SETTING=anything",
    "",
  ].join("\n");
  const fx = fixture(t, initial);
  assert.throws(() => apply(fx, configuration("disabled")), /unauthorized key/);
  assert.equal(fs.readFileSync(fx.runtimeEnvPath, "utf8"), initial);
  assert.equal(fs.existsSync(fx.backupPath), false);
});

test("provisions disabled mode against the documented runtime environment example", (t) => {
  const example = fs.readFileSync(
    path.join(__dirname, "runtime.env.example"),
    "utf8",
  );
  const fx = fixture(t, example);
  const existing = runtimeValues(fx);
  assert.equal(existing.PATHAO_MODE, "disabled");
  assert.equal(apply(fx, configuration("disabled")), "applied");
  const updated = runtimeValues(fx);
  assert.equal(updated.PATHAO_MODE, "disabled");
  assert.equal(updated.BETTER_AUTH_URL, existing.BETTER_AUTH_URL);
  assert.equal(updated.POSTGRES_DB, existing.POSTGRES_DB);
  assert.equal(updated.REDIS_URL, existing.REDIS_URL);
});

test("rejects a missing mode and incomplete or malformed sandbox configuration", (t) => {
  const fx = fixture(t);
  const missing = configuration("sandbox");
  missing.set("PATHAO_MODE", "");
  assert.throws(() => apply(fx, missing), /PATHAO_MODE/);
  assert.equal(
    fs.readFileSync(fx.runtimeEnvPath, "utf8"),
    "# Keep this comment\nAPP_NAME=aaraj\nOTHER_SECRET=unrelated-value\n",
  );

  for (const [key, value, expected] of [
    ["PATHAO_SANDBOX_CLIENT_SECRET", "", /PATHAO_SANDBOX_CLIENT_SECRET/],
    ["PATHAO_SANDBOX_USERNAME", "   ", /PATHAO_SANDBOX_USERNAME/],
    [
      "PATHAO_TOKEN_ENCRYPTION_KEY",
      "not-a-valid-key",
      /PATHAO_TOKEN_ENCRYPTION_KEY/,
    ],
    ["PATHAO_SANDBOX_APPROVED_STORE_IDS", "", /APPROVED_STORE_IDS/],
    ["PATHAO_SANDBOX_APPROVED_STORE_IDS", "101,01", /APPROVED_STORE_IDS/],
    ["PATHAO_SANDBOX_PASSWORD", "bad'password", /unsupported characters/],
  ]) {
    const invalid = configuration("sandbox", { [key]: value });
    assert.throws(() => apply(fx, invalid), expected, key);
    assert.equal(
      fs.existsSync(fx.backupPath),
      false,
      `${key} must not leave a rollback snapshot`,
    );
  }
});

test("builds the GitHub payload fail-closed and omits credentials while disabled", () => {
  const disabledPayload = buildPayload(
    {
      PATHAO_MODE: "disabled",
      PATHAO_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
      PATHAO_SANDBOX_CLIENT_SECRET: "stale-github-secret",
    },
    RELEASE,
  );
  const disabled = parsePayload(disabledPayload);
  assert.equal(disabled.values.get("PATHAO_MODE"), "disabled");
  assert.equal(disabled.values.get("PATHAO_TOKEN_ENCRYPTION_KEY"), TOKEN_KEY);
  assert.equal(disabled.values.get("PATHAO_SANDBOX_CLIENT_SECRET"), "");
  assert.doesNotMatch(disabledPayload, /stale-github-secret/);

  const sandboxPayload = buildPayload(
    {
      PATHAO_MODE: "sandbox",
      ...DUMMY_CREDENTIALS,
      PATHAO_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    },
    RELEASE,
  );
  assert.equal(
    parsePayload(sandboxPayload).values.get("PATHAO_SANDBOX_CLIENT_SECRET"),
    CLIENT_SECRET,
  );
  assert.throws(() => buildPayload({}, RELEASE), /PATHAO_MODE/);
  assert.throws(
    () => buildPayload({ PATHAO_MODE: "live" }, RELEASE),
    /PATHAO_MODE/,
  );
  assert.throws(
    () =>
      buildPayload(
        { PATHAO_MODE: "sandbox", PATHAO_TOKEN_ENCRYPTION_KEY: TOKEN_KEY },
        RELEASE,
      ),
    /PATHAO_SANDBOX_CLIENT_ID/,
  );
  assert.throws(
    () =>
      buildPayload(
        {
          PATHAO_MODE: "sandbox",
          ...DUMMY_CREDENTIALS,
          PATHAO_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
          PATHAO_SANDBOX_PASSWORD: "line1\nPATHAO_MODE=live",
        },
        RELEASE,
      ),
    /unsafe content/,
  );
});

test("rejects live mode even when live credentials and approval flags are supplied", (t) => {
  const fx = fixture(t);
  const live = configuration("live", {
    PATHAO_LIVE_CLIENT_ID: "dummy-live-id",
    PATHAO_LIVE_CLIENT_SECRET: "dummy-live-secret",
    PATHAO_LIVE_USERNAME: "dummy-live-user",
    PATHAO_LIVE_PASSWORD: "dummy-live-password",
    PATHAO_LIVE_WEBHOOK_SECRET: "dummy-live-webhook",
    PATHAO_LIVE_APPROVED_STORE_IDS: "901",
    PATHAO_LIVE_CREDENTIALS_ROTATED: "true",
    PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED: "true",
  });
  assert.throws(() => apply(fx, live), /live mode is blocked/);
  assert.equal(fs.existsSync(fx.backupPath), false);
});

test("rejects duplicate, unauthorized, and injection-shaped payload entries without leaking values", (t) => {
  const fx = fixture(t);
  const valid = payload("apply");
  const secret = CLIENT_SECRET;
  const duplicate = `${valid}PATHAO_MODE=disabled\n`;
  assert.throws(
    () => parsePayload(duplicate),
    (error) => {
      assert.match(error.message, /duplicate key PATHAO_MODE/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assert.throws(
    () => parsePayload(valid.replace(/\n$/, `\nPATHAO_EXTRA=${secret}\n`)),
    (error) => {
      assert.match(error.message, /unauthorized key PATHAO_EXTRA/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assert.throws(
    () => parsePayload(payload("restore", "../runtime.env")),
    /release identifier is invalid/,
  );
  assert.throws(
    () =>
      parsePayload(
        valid.replace("PATHAO_SANDBOX_PASSWORD=dummy-password-456\n", ""),
      ),
    /missing PATHAO_SANDBOX_PASSWORD/,
  );
  assert.throws(
    () =>
      parsePayload(
        valid.replace(
          "PATHAO_SANDBOX_PASSWORD=dummy-password-456",
          "PATHAO_SANDBOX_PASSWORD=harmless\nPATHAO_MODE=sandbox",
        ),
      ),
    /duplicate key PATHAO_MODE/,
  );
  assert.throws(
    () =>
      parsePayload(
        valid.replace("PATHAO_MODE=sandbox", "PATHAO_MODE=sandbox\r"),
      ),
    /line endings/,
  );

  const duplicateRuntime = fixture(t, "A=one\nA=two\n");
  assert.throws(() => apply(duplicateRuntime), /duplicate key A/);
  const unknownPathao = fixture(t, "PATHAO_OLD_SECRET=stale\n");
  assert.throws(
    () => apply(unknownPathao),
    /unauthorized key PATHAO_OLD_SECRET/,
  );
  const unrewritablePathao = fixture(
    t,
    'PATHAO_MODE=disabled\nPATHAO_SANDBOX_PASSWORD="cannot\'restore"\n',
  );
  assert.throws(
    () => apply(unrewritablePathao, configuration("disabled")),
    /cannot be safely rewritten/,
  );
  assert.equal(fs.existsSync(unrewritablePathao.backupPath), false);
});

test("rejects encryption key replacement and leaves the runtime file untouched", (t) => {
  const fx = fixture(
    t,
    `PATHAO_TOKEN_ENCRYPTION_KEY='${TOKEN_KEY}'\nAPP_NAME=aaraj\n`,
  );
  const before = fs.readFileSync(fx.runtimeEnvPath, "utf8");
  const replacement = crypto.randomBytes(32).toString("base64url");
  assert.throws(
    () =>
      apply(
        fx,
        configuration("sandbox", {
          PATHAO_TOKEN_ENCRYPTION_KEY: replacement,
        }),
      ),
    /replacement is blocked/,
  );
  assert.equal(fs.readFileSync(fx.runtimeEnvPath, "utf8"), before);
  assert.equal(fs.existsSync(fx.backupPath), false);
});

test("restores only prior Pathao values, keeps intervening unrelated changes, and commits snapshots", (t) => {
  const fx = fixture(
    t,
    "# Original comment\nAPP_NAME=old\nPATHAO_MODE=disabled\nPATHAO_SANDBOX_CLIENT_SECRET=stale\n",
  );
  assert.equal(apply(fx), "applied");
  fs.appendFileSync(fx.runtimeEnvPath, "ADMIN_NOTE=preserve-this\n");
  assert.equal(restoreConfiguration({ ...fx, release: RELEASE }), "restored");
  const restored = fs.readFileSync(fx.runtimeEnvPath, "utf8");
  const env = runtimeValues(fx);
  assert.equal(env.PATHAO_MODE, "disabled");
  assert.equal(env.PATHAO_SANDBOX_CLIENT_SECRET, "stale");
  assert.equal(env.PATHAO_SANDBOX_CLIENT_ID, undefined);
  assert.equal(env.ADMIN_NOTE, "preserve-this");
  assert.match(restored, /^# Original comment$/m);
  assert.equal(fs.existsSync(fx.backupPath), false);

  assert.equal(apply(fx), "applied");
  assert.equal(
    commitConfiguration({ backupPath: fx.backupPath, release: RELEASE }),
    "committed",
  );
  assert.equal(fs.existsSync(fx.backupPath), false);
  assert.equal(
    commitConfiguration({ backupPath: fx.backupPath, release: RELEASE }),
    "nothing-to-commit",
  );
});

test("leaves the original runtime file intact if atomic replacement fails", (t) => {
  const fx = fixture(t);
  const before = fs.readFileSync(fx.runtimeEnvPath, "utf8");
  let renames = 0;
  assert.throws(
    () =>
      apply(fx, configuration(), RELEASE, {
        renameFile(source, destination) {
          renames += 1;
          if (renames === 2) throw new Error("simulated rename failure");
          fs.renameSync(source, destination);
        },
      }),
    /Atomic runtime configuration update failed/,
  );
  assert.equal(fs.readFileSync(fx.runtimeEnvPath, "utf8"), before);
  assert.equal(fs.existsSync(fx.backupPath), false);
  assert.deepEqual(fs.readdirSync(fx.directory).sort(), ["runtime.env"]);
});

test("rejects hard-linked runtime files and leaves the linked file untouched", (t) => {
  const fx = fixture(t);
  const linkedPath = path.join(fx.directory, "runtime-copy.env");
  fs.linkSync(fx.runtimeEnvPath, linkedPath);
  const before = fs.readFileSync(linkedPath, "utf8");
  assert.throws(() => apply(fx), /single-link regular file/);
  assert.equal(fs.readFileSync(linkedPath, "utf8"), before);
  assert.equal(fs.existsSync(fx.backupPath), false);
});

test("rejects hard-linked and dangling-symlink rollback snapshots", (t) => {
  const hardLinked = fixture(t);
  assert.equal(apply(hardLinked), "applied");
  const snapshotCopy = path.join(hardLinked.directory, "snapshot-copy");
  fs.linkSync(hardLinked.backupPath, snapshotCopy);
  assert.throws(() => apply(hardLinked), /single-link regular file/);

  const danglingLink = fixture(t);
  fs.symlinkSync(
    path.join(danglingLink.directory, "missing-target"),
    danglingLink.backupPath,
  );
  assert.throws(() => apply(danglingLink), /single-link regular file/);
  assert.equal(fs.lstatSync(danglingLink.backupPath).isSymbolicLink(), true);
  assert.equal(
    fs.readFileSync(danglingLink.runtimeEnvPath, "utf8"),
    "# Keep this comment\nAPP_NAME=aaraj\nOTHER_SECRET=unrelated-value\n",
  );
});

test("supports same-release retries without replacing the original rollback snapshot", (t) => {
  const fx = fixture(t);
  assert.equal(apply(fx), "applied");
  const snapshotBefore = fs.readFileSync(fx.backupPath, "utf8");
  assert.equal(apply(fx), "already-applied");
  assert.equal(fs.readFileSync(fx.backupPath, "utf8"), snapshotBefore);
  assert.throws(
    () => apply(fx, configuration("disabled"), "b".repeat(40)),
    /snapshot does not match this release/,
  );
});

test("keeps the sudoers and installation contract narrowly scoped", (t) => {
  const hostDir = __dirname;
  const sudoers = fs.readFileSync(
    path.join(hostDir, "sudoers.aaraj-deploy"),
    "utf8",
  );
  const installer = fs.readFileSync(
    path.join(hostDir, "install-migration-autostart.sh"),
    "utf8",
  );
  assert.match(
    sudoers,
    /^  \/usr\/local\/sbin\/aaraj-configure-pathao\.cjs ""$/m,
  );
  assert.match(
    sudoers,
    /^Defaults!\/usr\/local\/sbin\/aaraj-configure-pathao\.cjs !use_pty$/m,
  );
  assert.doesNotMatch(sudoers, /aaraj-configure-pathao[^\n]*\*/);
  assert.match(installer, /aaraj-configure-pathao\.cjs/);
  assert.match(
    installer,
    /install -o root -g root -m 0755 "\$pathao_helper_source"/,
  );
  assert.match(installer, /install -o root -g root -m 0440 "\$sudoers_source"/);
  assert.match(installer, /visudo -cf/);
  const helper = fs.readFileSync(
    path.join(hostDir, "aaraj-configure-pathao.cjs"),
    "utf8",
  );
  assert.match(helper, /process\.argv\.length !== 2/);
});

test("syntax-checks the staged Pathao helper from stdin despite its temporary suffix", (t) => {
  const stageDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "aaraj-pathao-installer-syntax-"),
  );
  t.after(() => fs.rmSync(stageDir, { recursive: true, force: true }));

  const stagedHelper = path.join(stageDir, ".aaraj-configure-pathao.ABCDEFGH");
  fs.writeFileSync(stagedHelper, "module.exports = {};\n");

  const filenameCheck = spawnSync(process.execPath, ["--check", stagedHelper], {
    encoding: "utf8",
  });
  assert.notEqual(filenameCheck.status, 0);
  assert.match(filenameCheck.stderr, /ERR_UNKNOWN_FILE_EXTENSION/);

  const stdinCheck = spawnSync(
    process.execPath,
    ["--input-type=commonjs", "--check"],
    { input: fs.readFileSync(stagedHelper), encoding: "utf8" },
  );
  assert.equal(stdinCheck.status, 0, stdinCheck.stderr);

  const installer = fs.readFileSync(
    path.join(__dirname, "install-migration-autostart.sh"),
    "utf8",
  );
  assert.match(
    installer,
    /\/usr\/bin\/node --input-type=commonjs --check < "\$pathao_helper_stage"/,
  );
});

test("validates Pathao before VPS access and restores interrupted changes", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "../../../.github/workflows/production-release.yml"),
    "utf8",
  );
  const provision = workflow.indexOf(
    "- name: Validate and provision Pathao runtime configuration",
  );
  const stage = workflow.indexOf("- name: Stage and migrate AARAJ");
  const activation = workflow.indexOf("- name: Activate and verify AARAJ");
  const cleanup = workflow.indexOf(
    "- name: Restore pending Pathao configuration after interruption",
  );
  assert.ok(provision >= 0 && provision < stage && stage < activation);
  assert.ok(cleanup > activation);
  assert.match(
    workflow.slice(provision, stage),
    /buildPayload\(process\.env[\s\S]*?deploy-release\.sh pathao-apply/,
  );
  assert.doesNotMatch(
    workflow.slice(provision, stage),
    /PATHAO_MODE" != disabled/,
  );
  assert.match(
    workflow.slice(cleanup),
    /always\(\) && \(failure\(\) \|\| cancelled\(\)\)[\s\S]*?pathao-restore[\s\S]*?configuration restored\.[\s\S]*?deploy-release\.sh restart/,
  );
  for (const secret of [
    "PATHAO_TOKEN_ENCRYPTION_KEY",
    "PATHAO_SANDBOX_CLIENT_ID",
    "PATHAO_SANDBOX_CLIENT_SECRET",
    "PATHAO_SANDBOX_USERNAME",
    "PATHAO_SANDBOX_PASSWORD",
    "PATHAO_SANDBOX_WEBHOOK_SECRET",
  ]) {
    assert.equal(
      workflow.split(`secrets.${secret}`).length - 1,
      1,
      `${secret} must be scoped only to Pathao provisioning`,
    );
  }
});
