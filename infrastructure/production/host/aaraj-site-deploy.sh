#!/usr/bin/env bash
set -euo pipefail
umask 0027

SITE=/srv/sites/aaraj
RELEASES="$SITE/releases"
SHARED="$SITE/shared"
INCOMING="$SITE/incoming"
MAX_ARCHIVE_BYTES=536870912

usage() {
  echo "Usage: aaraj-site-deploy.sh <stage|migrate|grant-delivery-district-delete|activate> <commit-sha> <artifact-sha256>" >&2
  exit 2
}

[[ "$(id -un)" == "aaraj-deploy" ]] || { echo "Run as the unprivileged AARAJ deployment account." >&2; exit 1; }
[[ $# -ge 2 && $# -le 3 ]] || usage
operation="$1"
commit="$2"
digest="${3:-}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || usage
case "$operation" in
  stage|migrate|grant-delivery-district-delete|activate)
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || usage
    ;;
  *) usage ;;
esac
release_id="$commit-$digest"

for path in /srv /srv/sites "$SITE" "$RELEASES" "$SHARED" "$SHARED/next-cache" "$INCOMING"; do
  [[ -d "$path" && ! -L "$path" ]] || { echo "Required AARAJ site path is missing or symlinked: $path" >&2; exit 1; }
done
[[ "$(stat -c '%U:%G:%a' "$SITE")" == "root:aaraj-code:2750" && \
  "$(stat -c '%U:%G:%a' "$RELEASES")" == "aaraj-deploy:aaraj-code:2750" && \
  "$(stat -c '%U:%G:%a' "$SHARED")" == "root:aaraj-code:2750" && \
  "$(stat -c '%U:%G:%a' "$SHARED/next-cache")" == "root:aaraj:2770" && \
  "$(stat -c '%U:%G:%a' "$INCOMING")" == "aaraj-deploy:aaraj-deploy:700" ]] || {
  echo "AARAJ deployment directory ownership or permissions do not match the site boundary." >&2
  exit 1
}
exec 9>"$RELEASES/.deploy.lock"
flock -n 9 || { echo "Another AARAJ release operation is active." >&2; exit 1; }

INCOMING_ARCHIVE=""
STAGING_DIR=""
LINK_STAGE_DIR=""
cleanup_stage_files() {
  if [[ -n "$STAGING_DIR" ]]; then rm -rf -- "$STAGING_DIR"; fi
  if [[ -n "$INCOMING_ARCHIVE" ]]; then rm -f -- "$INCOMING_ARCHIVE"; fi
  if [[ -n "$LINK_STAGE_DIR" ]]; then rm -rf -- "$LINK_STAGE_DIR"; fi
}
trap cleanup_stage_files EXIT

stage_release() {
  local archive="$INCOMING/$release_id.tar.gz"
  local destination="$RELEASES/$release_id"
  local size actual_digest server_entry web_directory cache_directory
  INCOMING_ARCHIVE="$archive"

  [[ -f "$archive" && ! -L "$archive" ]] || { echo "Transferred AARAJ archive is missing or unsafe." >&2; exit 1; }
  size="$(stat -c '%s' -- "$archive")"
  (( size > 0 && size <= MAX_ARCHIVE_BYTES )) || { echo "AARAJ archive size is invalid." >&2; exit 1; }
  actual_digest="$(sha256sum -- "$archive" | awk '{print $1}')"
  [[ "$actual_digest" == "$digest" ]] || { echo "Transferred artifact checksum does not match." >&2; exit 1; }

  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ -d "$destination" && ! -L "$destination" && \
      -f "$destination/.artifact-sha256" && \
      "$(cat -- "$destination/.artifact-sha256")" == "$digest" ]] || {
      echo "Release already exists with a different artifact." >&2
      exit 1
    }
    verify_release "$release_id" >/dev/null
    rm -f -- "$archive"
    INCOMING_ARCHIVE=""
    echo "Release artifact $release_id is already staged."
    return
  fi

  STAGING_DIR="$(mktemp -d "$RELEASES/.staging-$release_id.XXXXXXXX")"
  python3 - "$archive" "$STAGING_DIR" <<'PY'
import pathlib
import sys
import tarfile

archive_path, destination = sys.argv[1:]
allowed_roots = {"api", "web", "release-manifest.json"}
seen = set()
expanded_size = 0

with tarfile.open(archive_path, "r:gz") as archive:
    members = archive.getmembers()
    if not members:
        raise SystemExit("Artifact archive is empty.")
    for member in members:
        raw_name = member.name
        if "\\" in raw_name or "\x00" in raw_name:
            raise SystemExit("Artifact contains an invalid path.")
        name = pathlib.PurePosixPath(raw_name)
        if name.is_absolute() or ".." in name.parts:
            raise SystemExit("Artifact contains a traversal path.")
        parts = tuple(part for part in name.parts if part not in ("", "."))
        normalized = "/".join(parts)
        if normalized and (
            parts[0] not in allowed_roots
            or (parts[0] == "release-manifest.json" and len(parts) != 1)
        ):
            raise SystemExit(f"Artifact contains an unexpected path: {raw_name}")
        if normalized in seen:
            raise SystemExit(f"Artifact contains a duplicate path: {raw_name}")
        seen.add(normalized)
        if member.islnk() or member.isdev() or member.isfifo():
            raise SystemExit("Artifact contains an unsupported link or special file.")
        if not (member.isdir() or member.isfile() or member.issym()):
            raise SystemExit("Artifact contains an unsupported file type.")
        if member.issym():
            target = pathlib.PurePosixPath(member.linkname)
            if target.is_absolute() or "\\" in member.linkname or "\x00" in member.linkname:
                raise SystemExit("Artifact contains an unsafe symbolic link.")
            depth = len(parts[:-1])
            for component in target.parts:
                if component in ("", "."):
                    continue
                depth += -1 if component == ".." else 1
                if depth < 0:
                    raise SystemExit("Artifact symbolic link escapes its release.")
        if member.isfile():
            expanded_size += member.size
            if expanded_size > 2 * 1024 * 1024 * 1024:
                raise SystemExit("Artifact uncompressed size exceeds the limit.")
    archive.extractall(path=destination, members=members, filter="data")
PY

  [[ -f "$STAGING_DIR/release-manifest.json" && ! -L "$STAGING_DIR/release-manifest.json" ]] || {
    echo "Artifact manifest is missing or unsafe." >&2
    exit 1
  }
  /usr/bin/node - "$STAGING_DIR/release-manifest.json" "$commit" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (
  manifest.application !== "aaraj" ||
  manifest.commit !== process.argv[3] ||
  manifest.dirty !== false ||
  !["release", "delivery-district-delete-grant"].includes(manifest.operation ?? "release") ||
  !/^v\d+\.\d+\.\d+$/.test(manifest.releaseTag) ||
  manifest.nodeVersion !== "24.22.1" ||
  manifest.pnpmVersion !== "12.15.0" ||
  manifest.api?.entrypoint !== "api/dist/main.js" ||
  manifest.api?.migrationEntrypoint !== "api/scripts/migrate-production.mjs" ||
  !["web/apps/web/server.js", "web/server.js"].includes(manifest.web?.serverEntrypoint) ||
  manifest.web?.apiOrigin !== "http://127.0.0.1:3001"
) {
  process.exitCode = 1;
}
NODE
  [[ -f "$STAGING_DIR/api/dist/main.js" && \
    -f "$STAGING_DIR/api/drizzle/meta/_journal.json" && \
    -f "$STAGING_DIR/api/scripts/migrate-production.mjs" ]] || {
    echo "Artifact is missing AARAJ API runtime or migration files." >&2
    exit 1
  }
  server_entry="$(/usr/bin/node -e 'const m=require(process.argv[1]); process.stdout.write(m.web.serverEntrypoint)' "$STAGING_DIR/release-manifest.json")"
  [[ -f "$STAGING_DIR/$server_entry" ]] || { echo "Artifact is missing its Next.js server." >&2; exit 1; }
  web_directory="$(dirname -- "$server_entry")"
  [[ -d "$STAGING_DIR/$web_directory/.next/static" && -d "$STAGING_DIR/$web_directory/public" ]] || {
    echo "Artifact is missing Next.js static or public files." >&2
    exit 1
  }

  cache_directory="$STAGING_DIR/$web_directory/.next/cache"
  [[ -d "$STAGING_DIR/$web_directory/.next" && ! -L "$STAGING_DIR/$web_directory/.next" ]] || {
    echo "Artifact Next.js directory is missing or unsafe." >&2
    exit 1
  }
  rm -rf -- "$cache_directory"
  ln -s -- "$SHARED/next-cache" "$cache_directory"
  printf '%s\n' "$digest" > "$STAGING_DIR/.artifact-sha256"

  find "$STAGING_DIR" -type d -exec chgrp aaraj-code {} +
  find "$STAGING_DIR" -type f -exec chgrp aaraj-code {} +
  find "$STAGING_DIR" -type d -exec chmod 2750 {} +
  find "$STAGING_DIR" -type f ! -perm /111 -exec chmod 0640 {} +
  find "$STAGING_DIR" -type f -perm /111 -exec chmod 0750 {} +
  mv -- "$STAGING_DIR" "$destination"
  STAGING_DIR=""
  rm -f -- "$archive"
  INCOMING_ARCHIVE=""
  echo "Staged AARAJ release artifact $release_id."
}

is_release_key() {
  [[ "$1" =~ ^[0-9a-f]{40}(-[0-9a-f]{64})?$ ]]
}

verify_release() {
  local release_key="$1"
  local expected_commit marker expected_digest=""
  local release="$RELEASES/$release_key"
  if [[ "$release_key" =~ ^([0-9a-f]{40})-([0-9a-f]{64})$ ]]; then
    expected_commit="${BASH_REMATCH[1]}"
    expected_digest="${BASH_REMATCH[2]}"
  else
    echo "Invalid AARAJ release identifier." >&2
    return 1
  fi
  [[ -d "$release" && ! -L "$release" && -f "$release/.artifact-sha256" ]] || {
    echo "Requested AARAJ release is not installed." >&2
    return 1
  }
  marker="$(cat -- "$release/.artifact-sha256")"
  [[ "$marker" =~ ^[0-9a-f]{64}$ ]] || {
    echo "Requested AARAJ release has an invalid artifact marker." >&2
    return 1
  }
  if [[ "$marker" != "$expected_digest" ]]; then
    echo "Requested AARAJ release does not match its artifact identifier." >&2
    return 1
  fi
  /usr/bin/node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (manifest.application !== "aaraj" || manifest.commit !== process.argv[2] || manifest.dirty !== false || !["release", "delivery-district-delete-grant"].includes(manifest.operation ?? "release")) process.exit(1);
  ' "$release/release-manifest.json" "$expected_commit" || return 1
  printf '%s\n' "$release"
}

atomic_link() {
  local link="$1" target="$2"
  [[ "$target" == "$RELEASES/"* && -d "$target" && \
    "${target##*/}" =~ ^[0-9a-f]{40}-[0-9a-f]{64}$ ]] || {
    echo "Invalid AARAJ release target." >&2
    exit 1
  }
  LINK_STAGE_DIR="$(mktemp -d "$RELEASES/.link.XXXXXXXX")"
  ln -s -- "$target" "$LINK_STAGE_DIR/target"
  mv -Tf -- "$LINK_STAGE_DIR/target" "$link"
  rmdir -- "$LINK_STAGE_DIR"
  LINK_STAGE_DIR=""
}

activate_release() {
  local target candidate
  target="$(verify_release "$release_id")"
  /usr/bin/node - "$target/release-manifest.json" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if ((manifest.operation ?? "release") !== "release") process.exit(1);
NODE
  atomic_link "$RELEASES/current" "$target"
  sudo -n /usr/bin/systemctl restart aaraj-pm2.service
  for candidate in "$RELEASES"/*; do
    [[ -d "$candidate" && ! -L "$candidate" ]] || continue
    is_release_key "${candidate##*/}" || continue
    [[ "$candidate" == "$target" ]] || rm -rf -- "$candidate"
  done
  echo "Activated AARAJ release artifact $release_id."
}

run_migration() {
  /usr/bin/sudo -n /usr/local/sbin/aaraj-start-migration "$commit" "$digest"
}

case "$operation" in
  stage)
    stage_release
    ;;
  activate)
    activate_release
    ;;
  migrate)
    run_migration
    ;;
  grant-delivery-district-delete)
    run_migration
    repair_release="$(verify_release "$release_id")"
    /usr/bin/node - "$repair_release/release-manifest.json" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (manifest.operation !== "delivery-district-delete-grant") process.exit(1);
NODE
    if [[ -L "$RELEASES/current" && \
      "$(readlink -f -- "$RELEASES/current")" == "$repair_release" ]]; then
      echo "Refusing to remove the active AARAJ release." >&2
      exit 1
    fi
    rm -rf -- "$repair_release"
    echo "Removed the completed permission-repair artifact."
    ;;
esac
