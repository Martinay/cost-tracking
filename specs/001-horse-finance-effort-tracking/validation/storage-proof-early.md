# Early storage proof results

- Date (UTC): 2026-10-09 23:09:39 UTC
- Runner command: `scripts/storage-proof.sh`
- Scope: local Linux container filesystem only; this is not an Azure Files SMB proof.
- Container image reference: `mcr.microsoft.com/dotnet/sdk@sha256:e362a8dbcd691522456da26a5198b8f3ca1d7641c95624fadc5e3e82678bd08a`
- Runtime: `.NET 10.0.3`
- Kernel: `Linux version 6.6.137-0-virt (buildozer@build-3-20-aarch64) (gcc (Alpine 13.2.1_git20240309) 13.2.1 20240309, GNU ld (GNU Binutils) 2.42) #1-Alpine SMP PREEMPT_DYNAMIC 2026-04-30 12:31:36`
- Proof filesystem: container temporary directory on Docker-managed local storage (`overlay / overlay rw,relatime,lowerdir=/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/423/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/381/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/380/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/379/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/378/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/377/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/376/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/375/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/374/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/373/fs:/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/372/fs,upperdir=/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/424/fs,workdir=/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/424/work 0 0`)
- SMB dialect, share SKU/billing model, effective SMB mount options: not applicable/unavailable; no share was mounted.
- `nobrl` / `nostrictsync` checks: not applicable; no CIFS mount was used.
- Azure target-share proof: UNPROVEN (no designated share configuration or mount was supplied).

| Local exercise | Result |
|---|---|
| Two-process first creation and same-version race | PASS: one committed version 1 event, one recoverable version conflict; both clients opened the same newly created stream. |
| Two-process idempotency race | PASS: same key/body returned the original version to both clients and a stale retry; changed body conflicted; exactly one event persisted. |
| Cross-process freshness and durable append | PASS: independent reader process observed committed version 1; stream ended in a complete newline-terminated event after writer acknowledgment. |
| Partial-tail recovery | PASS: independent reader preserved the original bytes in a restricted recovery backup and restored the committed prefix. |
| Unsupported lock | PASS: injected unsupported-lock errno failed closed with no event append. This checks the error path, not remote SMB lock support. |
| Independent process lock holder timeout | PASS: a second process timed out on the real Linux flock held by the first process; no event was appended. |
| Encrypted session storage with native Linux flock | PASS: encrypted session data was readable by handle after writing under an actual Linux stable-file flock; no token appeared as plaintext. |

The local results establish behavior on this Linux container's local filesystem only. They do not satisfy the deployment proof gate for independently mounted SMB clients, remote cache freshness, network faults, mount options, or restore.
