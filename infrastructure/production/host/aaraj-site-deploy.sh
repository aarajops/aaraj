#!/usr/bin/env bash
set -euo pipefail
umask 0027

SITE=/srv/sites/aaraj
RELEASES="$SITE/releases"
SHARED="$SITE/shared"
INCOMING="$SITE/incoming"
MAX_ARCHIVE_BYTES=536870912

usage() {
  echo "Usage: aaraj-site-deploy.sh <stage|migrate|grant-delivery-district-delete|activate|rollback|restart> <commit-sha> [sha256]" >&2
  exit 2
}

[[ "$(id -un)" == "aaraj-deploy" ]] || { echo "Run as the unprivileged AARAJ deployment account." >&2; exit 1; }
[[ $# -ge 2 && $# -le 3 ]] || usage
operation="$1"
commit="$2"
digest="${3:-}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || usage
case "$operation" in
  stage) [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || usage ;;
  migrate|grant-delivery-district-delete|activate|rollback|restart) [[ -z "$digest" ]] || usage ;;
  *) usage ;;
esac

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

stage_release() {
  local archive="$INCOMING/$commit.tar.gz"
  local destination="$RELEASES/$commit"
  local staging size actual_digest server_entry web_directory cache_directory

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
    verify_release "$commit" >/dev/null
    rm -f -- "$archive"
    echo "Release $commit is already staged."
    return
  fi

  staging="$(mktemp -d "$RELEASES/.staging-$commit.XXXXXXXX")"
  trap 'rm -rf -- "$staging"' EXIT
  python3 - "$archive" "$staging" <<'PY'
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

  [[ -f "$staging/release-manifest.json" && ! -L "$staging/release-manifest.json" ]] || {
    echo "Artifact manifest is missing or unsafe." >&2
    exit 1
  }
  /usr/bin/node - "$staging/release-manifest.json" "$commit" <<'NODE'
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
  [[ -f "$staging/api/dist/main.js" && \
    -f "$staging/api/drizzle/meta/_journal.json" && \
    -f "$staging/api/scripts/migrate-production.mjs" ]] || {
    echo "Artifact is missing AARAJ API runtime or migration files." >&2
    exit 1
  }
  server_entry="$(/usr/bin/node -e 'const m=require(process.argv[1]); process.stdout.write(m.web.serverEntrypoint)' "$staging/release-manifest.json")"
  [[ -f "$staging/$server_entry" ]] || { echo "Artifact is missing its Next.js server." >&2; exit 1; }
  web_directory="$(dirname -- "$server_entry")"
  [[ -d "$staging/$web_directory/.next/static" && -d "$staging/$web_directory/public" ]] || {
    echo "Artifact is missing Next.js static or public files." >&2
    exit 1
  }

  cache_directory="$staging/$web_directory/.next/cache"
  [[ -d "$staging/$web_directory/.next" && ! -L "$staging/$web_directory/.next" ]] || {
    echo "Artifact Next.js directory is missing or unsafe." >&2
    exit 1
  }
  rm -rf -- "$cache_directory"
  ln -s -- "$SHARED/next-cache" "$cache_directory"
  printf '%s\n' "$digest" > "$staging/.artifact-sha256"

  find "$staging" -type d -exec chgrp aaraj-code {} +
  find "$staging" -type f -exec chgrp aaraj-code {} +
  find "$staging" -type d -exec chmod 2750 {} +
  find "$staging" -type f ! -perm /111 -exec chmod 0640 {} +
  find "$staging" -type f -perm /111 -exec chmod 0750 {} +
  mv -- "$staging" "$destination"
  trap - EXIT
  rm -f -- "$archive"
  echo "Staged AARAJ release $commit."
}

verify_release() {
  local commit_sha="$1"
  local release="$RELEASES/$commit_sha"
  [[ -d "$release" && ! -L "$release" && -f "$release/.artifact-sha256" ]] || {
    echo "Requested AARAJ release is not installed." >&2
    return 1
  }
  /usr/bin/node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (manifest.application !== "aaraj" || manifest.commit !== process.argv[2] || manifest.dirty !== false || !["release", "delivery-district-delete-grant"].includes(manifest.operation ?? "release")) process.exit(1);
  ' "$release/release-manifest.json" "$commit_sha" || return 1
  printf '%s\n' "$release"
}

current_release_at() {
  local link="$1" target
  [[ -L "$link" ]] || { [[ ! -e "$link" ]] || { echo "Expected a release symlink at $link." >&2; return 1; }; return 0; }
  target="$(readlink -f -- "$link")"
  [[ "$target" == "$RELEASES/"* && "${target##*/}" =~ ^[0-9a-f]{40}$ && -d "$target" ]] || {
    echo "Release link escapes the AARAJ release directory." >&2
    return 1
  }
  printf '%s\n' "$target"
}

atomic_link() {
  local link="$1" target="$2" temporary
  [[ "$target" == "$RELEASES/"* && "${target##*/}" =~ ^[0-9a-f]{40}$ && -d "$target" ]] || {
    echo "Invalid AARAJ release target." >&2
    exit 1
  }
  temporary="$(mktemp -d "$RELEASES/.link.XXXXXXXX")"
  ln -s -- "$target" "$temporary/target"
  mv -Tf -- "$temporary/target" "$link"
  rmdir -- "$temporary"
}

activate_release() {
  local target old
  target="$(verify_release "$commit")"
  /usr/bin/node - "$target/release-manifest.json" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if ((manifest.operation ?? "release") !== "release") process.exit(1);
NODE
  old="$(current_release_at "$RELEASES/current")"
  if [[ -n "$old" && "$old" != "$target" ]]; then
    verify_release "${old##*/}" >/dev/null
    atomic_link "$RELEASES/previous" "$old"
  fi
  atomic_link "$RELEASES/current" "$target"
  sudo -n /usr/bin/systemctl restart aaraj-pm2.service
  echo "Activated AARAJ release $commit."
}

rollback_release() {
  local active previous
  active="$(current_release_at "$RELEASES/current")"
  if [[ -z "$active" || "${active##*/}" != "$commit" ]]; then
    echo "Release $commit was not activated; no code rollback was needed."
    return 0
  fi
  previous="$(current_release_at "$RELEASES/previous")"
  [[ -n "$previous" && "$previous" != "$active" ]] || { echo "No previous AARAJ release is available." >&2; exit 1; }
  verify_release "${previous##*/}" >/dev/null
  atomic_link "$RELEASES/previous" "$active"
  atomic_link "$RELEASES/current" "$previous"
  sudo -n /usr/bin/systemctl restart aaraj-pm2.service
  echo "Restored AARAJ release ${previous##*/}."
}

restart_current_release() {
  local active
  active="$(current_release_at "$RELEASES/current")"
  if [[ -z "$active" || "${active##*/}" != "$commit" ]]; then
    echo "Release $commit is not active; no service restart was needed."
    return 0
  fi
  verify_release "$commit" >/dev/null
  sudo -n /usr/bin/systemctl restart aaraj-pm2.service
  echo "Restarted AARAJ release $commit."
}

run_migration() {
  /usr/bin/sudo -n /usr/local/sbin/aaraj-start-migration "$commit"
}

case "$operation" in
  stage)
    stage_release
    ;;
  activate)
    activate_release
    ;;
  rollback)
    rollback_release
    ;;
  migrate)
    run_migration
    ;;
  grant-delivery-district-delete)
    run_migration
    ;;
  restart)
    restart_current_release
    ;;
esac
