#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: deploy-release.sh <stage|activate|rollback|wait-migration> <commit-sha> [archive]" >&2
  exit 2
}

[[ $# -ge 2 && $# -le 3 ]] || usage
operation="$1"
commit="$2"
archive="${3:-}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || usage
case "$operation" in
  stage) [[ $# == 3 && -f "$archive" ]] || usage ;;
  activate|rollback|wait-migration) [[ $# == 2 ]] || usage ;;
  *) usage ;;
esac

host="${AARAJ_DEPLOY_HOST:?AARAJ_DEPLOY_HOST must be configured in the protected environment}"
port="${AARAJ_DEPLOY_PORT:-22}"
remote_user="${AARAJ_DEPLOY_USER:?AARAJ_DEPLOY_USER must be configured in the protected environment}"
private_key="${AARAJ_DEPLOY_SSH_KEY:?AARAJ_DEPLOY_SSH_KEY must be configured in the protected environment}"
known_hosts_value="${AARAJ_DEPLOY_KNOWN_HOSTS:?AARAJ_DEPLOY_KNOWN_HOSTS must pin the VPS host key}"
[[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid deployment hostname." >&2; exit 2; }
if [[ ! "$port" =~ ^[0-9]{1,5}$ ]]; then
  echo "Invalid SSH port." >&2
  exit 2
fi
port_number=$((10#$port))
if (( port_number < 1 || port_number > 65535 )); then
  echo "Invalid SSH port." >&2
  exit 2
fi
[[ "$remote_user" == "aaraj-deploy" ]] || { echo "Only the AARAJ deployment account is allowed." >&2; exit 2; }

temporary="$(mktemp -d)"
trap 'rm -rf -- "$temporary"' EXIT
umask 077
key_file="$temporary/id_ed25519"
known_hosts_file="$temporary/known_hosts"
printf '%s\n' "$private_key" > "$key_file"
printf '%s\n' "$known_hosts_value" > "$known_hosts_file"
unset private_key known_hosts_value
chmod 0600 "$key_file" "$known_hosts_file"

if (( port == 22 )); then host_identity="$host"; else host_identity="[$host]:$port"; fi
ssh-keygen -F "$host_identity" -f "$known_hosts_file" >/dev/null || {
  echo "Pinned known_hosts has no entry for $host_identity." >&2
  exit 1
}

ssh_options=(
  -i "$key_file"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o PreferredAuthentications=publickey
  -o PasswordAuthentication=no
  -o KbdInteractiveAuthentication=no
  -o StrictHostKeyChecking=yes
  -o UpdateHostKeys=no
  -o CheckHostIP=yes
  -o UserKnownHostsFile="$known_hosts_file"
  -o GlobalKnownHostsFile=/dev/null
)
destination="$remote_user@$host"
remote_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/host/aaraj-site-deploy.sh"
[[ -f "$remote_script" ]] || { echo "AARAJ site deployment script is missing." >&2; exit 1; }

run_remote() {
  local remote_arguments
  printf -v remote_arguments '%q ' "$@"
  ssh -T -p "$port" "${ssh_options[@]}" "$destination" \
    "bash -s -- $remote_arguments" < "$remote_script"
}

if [[ "$operation" == "stage" ]]; then
  sidecar="$archive.sha256"
  [[ -f "$sidecar" ]] || { echo "Artifact checksum sidecar is missing." >&2; exit 1; }
  (cd "$(dirname "$archive")" && sha256sum --check "$(basename "$sidecar")")
  digest="$(awk 'NR == 1 { print $1 }' "$sidecar")"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid artifact checksum." >&2; exit 1; }

  scp -P "$port" "${ssh_options[@]}" -- "$archive" \
    "$destination:/srv/sites/aaraj/incoming/$commit.tar.gz"
  run_remote stage "$commit" "$digest"
else
  run_remote "$operation" "$commit"
fi
