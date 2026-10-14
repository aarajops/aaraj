#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "$(id -u)" == 0 ]] || { echo "Run this one-time setup as root." >&2; exit 1; }

host_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
wrapper_source="$host_dir/aaraj-start-migration"
pathao_helper_source="$host_dir/aaraj-configure-pathao.cjs"
sudoers_source="$host_dir/sudoers.aaraj-deploy"
wrapper_target=/usr/local/sbin/aaraj-start-migration
pathao_helper_target=/usr/local/sbin/aaraj-configure-pathao.cjs
sudoers_target=/etc/sudoers.d/aaraj-deploy

[[ -f "$wrapper_source" && ! -L "$wrapper_source" && \
  -f "$pathao_helper_source" && ! -L "$pathao_helper_source" && \
  -f "$sudoers_source" && ! -L "$sudoers_source" ]] || {
  echo "AARAJ deployment helper files are missing or unsafe." >&2
  exit 1
}
getent passwd aaraj-deploy >/dev/null
[[ -d /usr/local/sbin && ! -L /usr/local/sbin && \
  -d /etc/sudoers.d && ! -L /etc/sudoers.d ]] || {
  echo "Expected host command or sudoers directory is missing or unsafe." >&2
  exit 1
}
[[ -f /etc/systemd/system/aaraj-migration@.service && \
  ! -L /etc/systemd/system/aaraj-migration@.service ]] || {
  echo "The AARAJ migration service template is missing or unsafe." >&2
  exit 1
}
[[ ! -L "$wrapper_target" && ! -d "$wrapper_target" && \
  ! -L "$pathao_helper_target" && ! -d "$pathao_helper_target" && \
  ! -L "$sudoers_target" && ! -d "$sudoers_target" ]] || {
  echo "Refusing to replace a symlink or directory at a managed target." >&2
  exit 1
}

wrapper_stage="$(mktemp /usr/local/sbin/.aaraj-start-migration.XXXXXXXX)"
pathao_helper_stage="$(mktemp /usr/local/sbin/.aaraj-configure-pathao.XXXXXXXX)"
sudoers_stage="$(mktemp /etc/sudoers.d/.aaraj-deploy.XXXXXXXX)"
trap 'rm -f -- "$wrapper_stage" "$pathao_helper_stage" "$sudoers_stage"' EXIT

install -o root -g root -m 0755 "$wrapper_source" "$wrapper_stage"
install -o root -g root -m 0755 "$pathao_helper_source" "$pathao_helper_stage"
install -o root -g root -m 0440 "$sudoers_source" "$sudoers_stage"
bash -n "$wrapper_stage"
/usr/bin/node --check "$pathao_helper_stage"
visudo -cf "$sudoers_stage"

mv -f -- "$wrapper_stage" "$wrapper_target"
mv -f -- "$pathao_helper_stage" "$pathao_helper_target"
mv -f -- "$sudoers_stage" "$sudoers_target"
trap - EXIT

visudo -cf "$sudoers_target"
sudo -l -U aaraj-deploy
echo "PASS: CI/CD has only the approved AARAJ deployment helper permissions."
