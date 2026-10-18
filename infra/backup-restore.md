# Ledger backup and restore runbook

This runbook copies only immutable user event streams. It excludes WorkOS session files, Data Protection keys, certificates, snapshots, recovery scratch files, and any other operational state. Session continuity is intentionally independent of ledger recovery; missing sessions require sign-in again.

## Proposed retention and recovery objectives

Before deployment, configure an independently protected backup destination and adopt this baseline policy:

- Create one complete ledger backup every 24 hours and retain 30 dated generations.
- Keep the backup destination outside the live storage account/share and apply access controls that limit it to the backup operator and restore operator.
- Treat the resulting worst-case recovery point objective as 24 hours. Accepted writes newer than the selected backup are outside the restored prefix and may be lost; the scripts do not claim zero data loss.
- Use a four-hour recovery time objective as a planning target. It is unmeasured until a restore drill records elapsed time.
- Include destination capacity, transaction, retention, and network costs in the deployment estimate. These are proposed operating values, not measured service or billing results.

Do not delete generations from the independent destination as part of a backup run. Retention cleanup must preserve at least 30 verified daily generations; this is deliberately an operator-controlled step.

For each recovery incident, calculate data-loss age as `incident time UTC - createdAtUtc` from the latest successfully verified backup manifest. A 24-hour RPO is met only when the actual schedule has completed successfully and the selected manifest age is no more than 24 hours; a configured daily timer alone does not prove this. Alert on a missing/stale generation and include the selected manifest timestamp in the restore record.

## Create and verify a backup

Stop all API/container instances that can write the source root, including old revisions. Select an independently mounted destination. The explicit `--writers-stopped` flag records the operator's quiescence assertion; the script cannot inspect remote container state.

```sh
scripts/backup-ledger.sh /data /mnt/independent-backup/2026-10-09 --writers-stopped
scripts/restore-ledger.sh --verify-only /mnt/independent-backup/2026-10-09
```

The destination must be new and outside the source tree. The tool validates that every stream has complete newline-terminated JSON, one stable subject matching its SHA-256 path, and contiguous versions starting at 1. It writes the exact source bytes plus `manifest.json`, with event count, last version, and SHA-256 for each stream. It flushes files before publishing the completed directory. A malformed, truncated, mixed-owner, or gapped stream aborts without changing source bytes. Authentication and other non-ledger files are not copied.

The manifest is a consistency record, not an encryption layer or a backup service. Protect the external destination with the platform's encryption, retention, access, and monitoring controls. Never place the independent copy under `/data` or in the same storage failure domain.

## Restore to a fresh root

Keep all writers stopped. Verify the selected backup and restore to a new mount or empty path reserved for recovery:

```sh
scripts/restore-ledger.sh --verify-only /mnt/independent-backup/2026-10-09
scripts/restore-ledger.sh /mnt/independent-backup/2026-10-09 /data-recovery --writers-stopped
```

The restore destination must not exist, and it must be separate from the backup. The command validates every manifest checksum and stream prefix before publishing the restored directory. It never merges with or overwrites a live data root. Preserve the source share and original backup until all checks finish.

After restore, use the application against the fresh root in an isolated environment and compare the restored version/count/checksum with the selected manifest. Run deterministic replay and reconciliation fixtures to compare per-horse monthly/lifetime totals and pending approval keys. Record the backup timestamp, latest stream version, event counts, checksums, report totals, pending keys, measured restore duration, and the accepted-write age represented by the backup. Do not redirect production traffic until those comparisons pass and the owner has chosen whether the documented recovery point is acceptable.

## Local dry run

The repository test uses synthetic event streams in a temporary directory and does not contact Azure or provision infrastructure:

```sh
node --test scripts/backup-restore.test.mjs
```

This verifies manifest/checksum handling, fresh-destination behavior, and byte-identical preservation of the repository's canonical fixture containing all 17 event variants. The ops-only `scripts/verify-restore-replay.mjs` check also replays a 100-horse/5,000-change synthetic TestHost stream after backup and restore without reseeding, comparing monthly report aggregate projections and every pending approval key by digest; its evidence is in `specs/001-horse-finance-effort-tracking/validation/ops-restore-replay.json`. This local check does not establish independent Azure backup retention, live-writer shutdown, target-share consistency, scheduled 24-hour RPO, measured recovery objectives, or billing. Those remain release evidence to collect on the designated synthetic resources.
