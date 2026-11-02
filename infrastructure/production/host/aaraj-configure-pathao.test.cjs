"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseEnv } = require("node:util");

const {
  PATHAO_KEYS,
  applyConfiguration,
  buildPayload,
  parsePayload,
} = require("./aaraj-configure-pathao.cjs");

const CLIENT_SECRET = "dummy-client-secret-123";
const DUMMY_CREDENTIALS = {
  PATHAO_CLIENT_ID: "dummy-live-client-id",
  PATHAO_CLIENT_SECRET: CLIENT_SECRET,
  PATHAO_USERNAME: "live-ops@example.invalid",
  PATHAO_PASSWORD: "dummy-live-password",
  PATHAO_WEBHOOK_SECRET: "dummy-live-webhook-secret",
};

function configuration(configured = true, overrides = {}) {
  const values = new Map(PATHAO_KEYS.map((key) => [key, ""]));
  if (configured) {
    for (const [key, value] of Object.entries(DUMMY_CREDENTIALS))
      values.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) values.set(key, value);
  return values;
}

function payload(values = configuration()) {
  return `${PATHAO_KEYS.map((key) => `${key}=${values.get(key)}`).join("\n")}\n`;
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
  fs.writeFileSync(runtimeEnvPath, initial, { mode: 0o640 });
  fs.chmodSync(runtimeEnvPath, 0o640);
  return { directory, runtimeEnvPath };
}

function apply(fx, values = configuration(), extra = {}) {
  return applyConfiguration({
    runtimeEnvPath: fx.runtimeEnvPath,
    values,
    ...extra,
  });
}

function runtimeValues(fx) {
  return parseEnv(fs.readFileSync(fx.runtimeEnvPath, "utf8"));
}

test("applies complete live settings atomically and preserves unrelated entries and comments", (t) => {
  const fx = fixture(t);
  const ownerBefore = fs.statSync(fx.runtimeEnvPath);
  const result = apply(fx);
  assert.equal(result, "applied");
  assert.doesNotMatch(result, /dummy|secret/i);
  const contents = fs.readFileSync(fx.runtimeEnvPath, "utf8");
  const env = runtimeValues(fx);
  assert.equal(env.PATHAO_CLIENT_SECRET, CLIENT_SECRET);
  assert.match(contents, /^# Keep this comment$/m);
  assert.equal(env.APP_NAME, "aaraj");
  assert.equal(env.OTHER_SECRET, "unrelated-value");
  const ownerAfter = fs.statSync(fx.runtimeEnvPath);
  assert.equal(ownerAfter.mode & 0o777, 0o640);
  assert.equal(ownerAfter.uid, ownerBefore.uid);
  assert.equal(ownerAfter.gid, ownerBefore.gid);
  assert.doesNotMatch(
    contents,
    /PATHAO_CLIENT_SECRET=dummy-client-secret/,
  );
});

test("keeps shell-looking credential text literal in the Node env file", (t) => {
  const fx = fixture(t);
  const literal = "$(touch /tmp/aaraj-pathao-injection-marker);#literal";
  assert.equal(
    apply(
      fx,
      configuration(true, {
        PATHAO_PASSWORD: literal,
      }),
    ),
    "applied",
  );
  assert.equal(runtimeValues(fx).PATHAO_PASSWORD, literal);
  const sourced = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; printf %s "$PATHAO_PASSWORD"',
      "bash",
      fx.runtimeEnvPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(sourced.status, 0, sourced.stderr);
  assert.equal(sourced.stdout, literal);
  assert.equal(fs.existsSync("/tmp/aaraj-pathao-injection-marker"), false);
});

test("removes stale Pathao runtime entries while preserving other settings", (t) => {
  const initial = [
    "APP_NAME=aaraj",
    "PATHAO_UNRECOGNIZED_SETTING=anything",
    "",
  ].join("\n");
  const fx = fixture(t, initial);
  assert.equal(apply(fx, configuration(false)), "applied");
  const updated = runtimeValues(fx);
  assert.equal(updated.PATHAO_UNRECOGNIZED_SETTING, undefined);
  assert.equal(updated.APP_NAME, "aaraj");
});

test("accepts an already-unconfigured Pathao integration in the runtime environment example", (t) => {
  const example = fs.readFileSync(
    path.join(__dirname, "runtime.env.example"),
    "utf8",
  );
  const fx = fixture(t, example);
  const original = fs.readFileSync(fx.runtimeEnvPath, "utf8");
  const existing = runtimeValues(fx);
  assert.equal(existing.PATHAO_CLIENT_ID, "");
  assert.equal(apply(fx, configuration(false)), "already-applied");
  assert.equal(fs.readFileSync(fx.runtimeEnvPath, "utf8"), original);
});

test("rejects incomplete or malformed Pathao configuration before writing", (t) => {
  const fx = fixture(t);
  for (const [key, value, expected] of [
    ["PATHAO_CLIENT_SECRET", "", /PATHAO_CLIENT_SECRET/],
    ["PATHAO_USERNAME", "   ", /PATHAO_USERNAME/],
    ["PATHAO_PASSWORD", "bad'password", /unsupported characters/],
  ]) {
    const invalid = configuration(true, { [key]: value });
    assert.throws(() => apply(fx, invalid), expected, key);
    assert.equal(
      fs.readFileSync(fx.runtimeEnvPath, "utf8"),
      "# Keep this comment\nAPP_NAME=aaraj\nOTHER_SECRET=unrelated-value\n",
    );
  }
});

test("builds the runtime payload from live merchant credentials", () => {
  const livePayload = buildPayload(DUMMY_CREDENTIALS);
  const live = parsePayload(livePayload);
  assert.equal(live.get("PATHAO_CLIENT_SECRET"), CLIENT_SECRET);
  assert.throws(
    () =>
      buildPayload({
        ...DUMMY_CREDENTIALS,
        PATHAO_PASSWORD: "line1\nPATHAO_CLIENT_ID=extra",
      }),
    /unsafe content/,
  );
});

test("applies live settings and removes obsolete selectors and credentials", (t) => {
  const fx = fixture(t);
  fs.writeFileSync(
    fx.runtimeEnvPath,
    "APP_NAME=aaraj\nPATHAO_BASE_URL=https://old.example\nPATHAO_OLD_PASSWORD=old\n",
  );
  fs.chmodSync(fx.runtimeEnvPath, 0o640);
  assert.equal(apply(fx), "applied");
  const env = runtimeValues(fx);
  assert.equal(env.PATHAO_CLIENT_SECRET, CLIENT_SECRET);
  assert.equal(env.PATHAO_BASE_URL, undefined);
  assert.equal(env.PATHAO_OLD_PASSWORD, undefined);
  assert.doesNotMatch(apply(fx), /dummy-live/);
});

test("rejects duplicate, unauthorized, and injection-shaped payload entries without leaking values", (t) => {
  const fx = fixture(t);
  const valid = payload();
  const secret = CLIENT_SECRET;
  const duplicate = `${valid}PATHAO_CLIENT_ID=duplicate\n`;
  assert.throws(
    () => parsePayload(duplicate),
    (error) => {
      assert.match(error.message, /duplicate key PATHAO_CLIENT_ID/);
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
    () => parsePayload("operation=unknown\n"),
    /unauthorized key operation/,
  );
  assert.throws(
    () =>
      parsePayload(
        valid.replace("PATHAO_PASSWORD=dummy-live-password\n", ""),
      ),
    /missing PATHAO_PASSWORD/,
  );
  assert.throws(
    () =>
      parsePayload(
        valid.replace(
          "PATHAO_PASSWORD=dummy-live-password",
          "PATHAO_PASSWORD=harmless\nPATHAO_CLIENT_ID=duplicate",
        ),
      ),
    /duplicate key PATHAO_CLIENT_ID/,
  );

  const duplicateRuntime = fixture(t, "A=one\nA=two\n");
  assert.throws(() => apply(duplicateRuntime), /duplicate key A/);
  const unknownPathao = fixture(t, "PATHAO_OBSOLETE_FIELD=stale\n");
  assert.equal(apply(unknownPathao), "applied");
  assert.equal(runtimeValues(unknownPathao).PATHAO_OBSOLETE_FIELD, undefined);
  const unrewritablePathao = fixture(
    t,
    'PATHAO_PASSWORD="cannot\'be-rewritten"\n',
  );
  assert.throws(
    () => apply(unrewritablePathao, configuration(false)),
    /cannot be safely rewritten/,
  );
});

test("leaves the original runtime file intact if atomic replacement fails", (t) => {
  const fx = fixture(t);
  const before = fs.readFileSync(fx.runtimeEnvPath, "utf8");
  let renames = 0;
  assert.throws(
    () =>
      apply(fx, configuration(), {
        renameFile(source, destination) {
          renames += 1;
          if (renames === 1) throw new Error("simulated rename failure");
          fs.renameSync(source, destination);
        },
      }),
    /Atomic runtime configuration update failed/,
  );
  assert.equal(fs.readFileSync(fx.runtimeEnvPath, "utf8"), before);
  assert.deepEqual(fs.readdirSync(fx.directory).sort(), ["runtime.env"]);
});

test("rejects hard-linked runtime files and leaves the linked file untouched", (t) => {
  const fx = fixture(t);
  const linkedPath = path.join(fx.directory, "runtime-copy.env");
  fs.linkSync(fx.runtimeEnvPath, linkedPath);
  const before = fs.readFileSync(linkedPath, "utf8");
  assert.throws(() => apply(fx), /single-link regular file/);
  assert.equal(fs.readFileSync(linkedPath, "utf8"), before);
});

test("applies the requested configuration directly and accepts idempotent retries", (t) => {
  const fx = fixture(t);
  assert.equal(apply(fx), "applied");
  assert.equal(apply(fx), "already-applied");
  assert.equal(apply(fx, configuration(false)), "applied");
  assert.equal(runtimeValues(fx).PATHAO_CLIENT_ID, "");
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

test("validates and applies Pathao before staging and migration", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "../../../.github/workflows/production-release.yml"),
    "utf8",
  );
  const provision = workflow.indexOf(
    "- name: Validate and provision Pathao runtime configuration",
  );
  const stage = workflow.indexOf("- name: Stage and migrate AARAJ");
  const activation = workflow.indexOf("- name: Activate and verify AARAJ");
  assert.ok(provision >= 0 && provision < stage && stage < activation);
  assert.match(
    workflow.slice(provision, activation),
    /buildPayload\(process\.env[\s\S]*?deploy-release\.sh pathao-apply/,
  );
  for (const secret of [
    "PATHAO_CLIENT_ID",
    "PATHAO_CLIENT_SECRET",
    "PATHAO_USERNAME",
    "PATHAO_PASSWORD",
    "PATHAO_WEBHOOK_SECRET",
  ]) {
    assert.equal(
      workflow.split(`secrets.${secret}`).length - 1,
      1,
      `${secret} must be scoped only to Pathao provisioning`,
    );
  }
  assert.doesNotMatch(
    workflow.slice(provision, activation),
    /PATHAO_(?:BASE_URL|SANDBOX)/,
  );
});
