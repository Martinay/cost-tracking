#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == "--verify-only" && $# -eq 2 ]]; then
  exec python3 "$repo_root/scripts/ledger-archive.py" verify "$2"
fi
if [[ $# -ne 3 || "$3" != "--writers-stopped" ]]; then
  printf '%s\n' 'Usage: scripts/restore-ledger.sh <verified-backup-directory> <new-fresh-storage-root> --writers-stopped' >&2
  printf '%s\n' 'Usage: scripts/restore-ledger.sh --verify-only <backup-directory>' >&2
  printf '%s\n' 'Stop every process that can write the restore destination before acknowledging this flag.' >&2
  exit 2
fi

exec python3 "$repo_root/scripts/ledger-archive.py" restore "$1" "$2" --writers-stopped
