# Storage and Recovery Contract

Path `/data/users/<sha256-sub>/events_<sha256-sub>.jsonl`. Server alone derives paths. Snapshot files are siblings; backups/recovery originals are restricted operational artifacts, never served through static hosting. Event format is [events-v1.schema.json](events-v1.schema.json). All state is subject-local; one command appends exactly one event.

## Locked operation

1. Authenticate and validate request syntax. Acquire subject semaphore with bounded cancellation-aware timeout.
2. Open stable event file read/write with shared-open permission; the application does not rely on implicit .NET sharing locks. Acquire explicit Linux `flock(LOCK_EX|LOCK_NB)` on that handle and check the return/errno. Retry only contention within a five-second deadline; retry EINTR while within deadline. Unsupported locking, permissions or other I/O errors fail closed. No unlocked fallback. Initial directory/file creation uses the same stable target file so competing creators lock the same inode.
3. Under the verified lock, inspect committed bytes and recover only an unterminated final line. Persist a restricted backup of original bytes first; if backup or repair flush fails, abort. Corrupt terminated JSON, gaps, duplicate versions, wrong subject or unsupported event schemas fail closed.
4. Check idempotency key against stream and hash before comparing expected version. Same key/hash returns original command response; changed hash is 409. Hash canonical command type/method/route/body, not inferred defaults or mutable state. The event's commandHash and payload are sufficient to recover response using the prefix at that event version.
5. Compare expected/current version; return 409 on mismatch. Refresh immutable projection through the committed version and validate domain invariants. Read cache freshness under this lock; mtime alone cannot establish freshness across mounts. Initially inspect committed version directly, then replay suffix; optimize only after measured correctness.
6. Serialize one compact UTF-8 JSON object and newline, append completely, flush encoder/stream buffers, then call `FileStream.Flush(flushToDisk: true)`. Cancellation after append begins must resolve the flush/recovery boundary before releasing ownership; never label an ambiguous commit unsuccessful without safe retry guidance.
7. After durable success, update cache and return the event's version/result. Release OS lock, close handle and release semaphore in all paths. A lost response after flush is resolved by the original idempotency key.

Read requests capture an immutable projection/version under the same guard, then perform pure expansion/reporting outside it. They never append ordinary occurrences or pending items. A cache error rebuilds from events. Replacing/deleting a live event file would break inode-based locking and is forbidden during normal service. Restore operates only while writers are stopped.

## Snapshots

After 5,000 events, at most once per further 1,000 events, a projection snapshot may be written under the subject guard. Include subject hash, stream version, snapshot schema version, prefix checksum, and all replay state needed for history/decisions/idempotency or retain access to the corresponding event prefix. Write unique temporary file in the same directory, flush to disk, close, then replace snapshot. Interrupted/failed replacement is never a financial-data failure; ignore unusable cache and replay. Never prune committed events. Snapshot errors receive operational telemetry without private payloads.

## Isolation and credentials

The Container Apps Azure Files mount uses protected storage-account credentials according to the selected supported resource configuration. Restrict configuration/secret access and share permissions, encrypt transport and storage, and disable arbitrary filesystem serving. File paths are SHA-256 subject based. No tokens, private payloads or financial values in logs. Correlation IDs, event type, stream version and operational error class are sufficient diagnostics.

## Deployment proof gate

Local temporary-file tests do not satisfy this gate. Record the actual image digest, .NET/runtime version, Linux kernel, SMB dialect, share SKU/billing model and effective mount options. Reject `nobrl` and `nostrictsync`; unsupported semantics block deployment even if only one replica is configured. Exercise two independently mounted containers, including overlapping deployment revisions.

| Exercise | Required evidence |
|---|---|
| Same expected version, divergent writes | Exactly one committed event and one recoverable conflict; contiguous versions |
| Same key/body; same key/changed body | One commit and original response; changed command conflicts |
| First stream creation race | Both writers use one stream; no lost file/line |
| Unsupported lock/lock holder timeout | No append; 503 and diagnostic classification |
| Cross-client append/read | Reader observes committed version; no stale process-cache success |
| Terminate before/during append/flush/after flush before response | Acknowledged events survive; partial final line repaired only with preserved original; ambiguous retry never duplicates |
| Network interruption/reconnect | Fail closed or commit durably; recovery reconciles exact versions and keys |
| Snapshot replacement interruption/corrupt snapshot | Full replay equals valid snapshot replay; no event loss |
| Corrupt terminated line/unknown schema | Stream unavailable, no silent skip/overwrite |
| Restore independent backup into fresh share | Versions/counts/checksums and monthly/lifetime/pending results match backed-up prefix |

Share snapshots/projection snapshots alone do not prove independent disaster recovery. Define retained backup frequency and recovery objectives before release, record restored prefix/time and any accepted events newer than the backup, and do not imply zero data loss from an older backup. Release requires a tested restore procedure and a costed retention policy.
