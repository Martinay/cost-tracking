#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 3 || "$3" != "--writers-stopped" ]]; then
  printf '%s\n' 'Usage: scripts/backup-ledger.sh <storage-root> <new-independent-backup-directory> --writers-stopped' >&2
  printf '%s\n' 'Stop every process that can write the storage root before acknowledging this flag.' >&2
  exit 2
fi

exec python3 "$repo_root/scripts/ledger-archive.py" backup "$1" "$2" --writers-stopped
