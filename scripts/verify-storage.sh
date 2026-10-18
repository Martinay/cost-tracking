#!/usr/bin/env bash
set -euo pipefail

mode="${1:-local}"

if [[ "$mode" == "--container-client" ]]; then
  shift
  exec bash /repo/scripts/storage-proof.sh --container-client "$@"
fi

repo_root="$(git rev-parse --show-toplevel)"

if [[ "$mode" == "local" || "$mode" == "--local" ]]; then
  exec bash "$repo_root/scripts/storage-proof.sh"
fi

if [[ "$mode" != "--azure" ]]; then
  printf '%s\n' 'Usage: scripts/verify-storage.sh [--local|--azure]' >&2
  exit 2
fi

bash "$repo_root/scripts/storage-proof.sh"

required=(
  STORAGE_PROOF_STORAGE_ACCOUNT
  STORAGE_PROOF_STORAGE_KEY
  STORAGE_PROOF_FILE_SHARE
  STORAGE_PROOF_MOUNT_OPTIONS
  STORAGE_PROOF_SHARE_SKU
  STORAGE_PROOF_BILLING_MODEL
)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if (( ${#missing[@]} > 0 )); then
  printf 'UNPROVEN: designated Azure SMB proof was not run; missing configuration: %s\n' "${missing[*]}" >&2
  exit 2
fi

mount_options_lc=",${STORAGE_PROOF_MOUNT_OPTIONS,,},"
if [[ "$mount_options_lc" =~ ,(nobrl|nostrictsync)(,|=) ]]; then
  printf '%s\n' 'REJECTED: STORAGE_PROOF_MOUNT_OPTIONS contains nobrl or nostrictsync.' >&2
  exit 2
fi
if [[ "$mount_options_lc" != *,vers=3.0,* && "$mount_options_lc" != *,vers=3.02,* && "$mount_options_lc" != *,vers=3.1.1,* ]]; then
  printf '%s\n' 'REJECTED: SMB proof requires an explicit SMB 3.x vers= mount option.' >&2
  exit 2
fi

image="${STORAGE_PROOF_IMAGE:-mcr.microsoft.com/dotnet/sdk:10.0.103}"
export STORAGE_PROOF_IMAGE="$image"
export STORAGE_PROOF_IMAGE_DIGEST="$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$image")"
export STORAGE_PROOF_RUN_ID="$(python3 -c 'import secrets; print(secrets.token_hex(12))')"
project="storage-proof-${STORAGE_PROOF_RUN_ID}"
compose_file="$repo_root/infra/storage-proof.compose.yml"

cleanup() {
  docker compose --project-name "$project" --file "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose --project-name "$project" --file "$compose_file" up --abort-on-container-exit --exit-code-from verify
