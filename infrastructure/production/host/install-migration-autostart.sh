#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "$(id -u)" == 0 ]] || { echo "Run this one-time setup as root." >&2; exit 1; }

host_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
wrapper_source="$host_dir/aaraj-start-migration"
pathao_helper_source="$host_dir/aaraj-configure-pathao.cjs"
service_source="$host_dir/aaraj-migration@.service"
sudoers_source="$host_dir/sudoers.aaraj-deploy"
wrapper_target=/usr/local/sbin/aaraj-start-migration
legacy_backup_verifier=/usr/local/sbin/aaraj-verify-backup
pathao_helper_target=/usr/local/sbin/aaraj-configure-pathao.cjs
service_target=/etc/systemd/system/aaraj-migration@.service
sudoers_target=/etc/sudoers.d/aaraj-deploy
releases=/srv/sites/aaraj/releases
previous_release="$releases/previous"
pathao_snapshot=/etc/sites/aaraj/.runtime.env.pathao-backup

[[ -f "$wrapper_source" && ! -L "$wrapper_source" && \
  -f "$pathao_helper_source" && ! -L "$pathao_helper_source" && \
  -f "$service_source" && ! -L "$service_source" && \
  -f "$sudoers_source" && ! -L "$sudoers_source" ]] || {
  echo "AARAJ deployment helper files are missing or unsafe." >&2
  exit 1
}
getent passwd aaraj-deploy >/dev/null
[[ -d /usr/local/sbin && ! -L /usr/local/sbin && \
  -d /etc/sudoers.d && ! -L /etc/sudoers.d && \
  -d "$releases" && ! -L "$releases" && \
  -d /etc/sites/aaraj && ! -L /etc/sites/aaraj ]] || {
  echo "Expected host command or sudoers directory is missing or unsafe." >&2
  exit 1
}
[[ -f "$service_target" && ! -L "$service_target" && \
  "$(stat -c '%u:%g' -- "$service_target")" == "0:0" ]] || {
  echo "The AARAJ migration service template is missing or unsafe." >&2
  exit 1
}
[[ ! -L "$wrapper_target" && ! -d "$wrapper_target" && \
  ! -L "$pathao_helper_target" && ! -d "$pathao_helper_target" && \
  ! -L "$sudoers_target" && ! -d "$sudoers_target" ]] || {
  echo "Refusing to replace a symlink or directory at a managed target." >&2
  exit 1
}
if [[ -e "$pathao_snapshot" || -L "$pathao_snapshot" ]]; then
  [[ -f "$pathao_snapshot" && ! -L "$pathao_snapshot" && \
    "$(stat -c '%u:%g:%a:%h' -- "$pathao_snapshot")" == "0:0:600:1" ]] || {
    echo "Refusing to remove an unsafe Pathao configuration snapshot." >&2
    exit 1
  }
fi
if [[ -e "$legacy_backup_verifier" || -L "$legacy_backup_verifier" ]]; then
  [[ -f "$legacy_backup_verifier" && ! -L "$legacy_backup_verifier" && \
    "$(stat -c '%u:%g' -- "$legacy_backup_verifier")" == "0:0" ]] || {
    echo "Refusing to remove an unsafe obsolete host helper." >&2
    exit 1
  }
fi
if [[ -e "$previous_release" || -L "$previous_release" ]]; then
  [[ -L "$previous_release" ]] || {
    echo "Refusing to remove an unexpected release entry." >&2
    exit 1
  }
fi

wrapper_stage=""
pathao_helper_stage=""
service_stage=""
sudoers_stage=""
cleanup_stages() {
  local staged_file
  for staged_file in "$wrapper_stage" "$pathao_helper_stage" "$service_stage" "$sudoers_stage"; do
    if [[ -n "$staged_file" ]]; then
      rm -f -- "$staged_file"
    fi
  done
}
trap cleanup_stages EXIT

wrapper_stage="$(mktemp /usr/local/sbin/.aaraj-start-migration.XXXXXXXX)"
pathao_helper_stage="$(mktemp /usr/local/sbin/.aaraj-configure-pathao.XXXXXXXX)"
service_stage="$(mktemp /etc/systemd/system/.aaraj-migration.XXXXXXXX)"
sudoers_stage="$(mktemp /etc/sudoers.d/.aaraj-deploy.XXXXXXXX)"

install -o root -g root -m 0755 "$wrapper_source" "$wrapper_stage"
install -o root -g root -m 0755 "$pathao_helper_source" "$pathao_helper_stage"
install -o root -g root -m 0644 "$service_source" "$service_stage"
install -o root -g root -m 0440 "$sudoers_source" "$sudoers_stage"
bash -n "$wrapper_stage"
/usr/bin/node --input-type=commonjs --check < "$pathao_helper_stage"
visudo -cf "$sudoers_stage"

mv -f -- "$wrapper_stage" "$wrapper_target"
mv -f -- "$pathao_helper_stage" "$pathao_helper_target"
mv -f -- "$service_stage" "$service_target"
mv -f -- "$sudoers_stage" "$sudoers_target"
rm -f -- "$pathao_snapshot"
rm -f -- "$legacy_backup_verifier"
rm -f -- "$previous_release"
trap - EXIT

systemctl daemon-reload
visudo -cf "$sudoers_target"
sudo -l -U aaraj-deploy
echo "PASS: AARAJ migration helpers are installed and CI/CD has only the approved deployment permissions."
