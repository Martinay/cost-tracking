# Operations infrastructure and CI evidence

## Local validation run

The following checks were run locally without deploying cloud resources:

- `.github/workflows/ci.yml` parsed as YAML; `infra/parameters.example.json` parsed as JSON.
- `az bicep build --file infra/main.bicep --outfile /private/tmp/cost-tracking-main.json` passed with Bicep 0.48.1.
- `docker build --file backend/Dockerfile --tag cost-tracking-api:local .` passed. `docker run --rm --entrypoint id cost-tracking-api:local` returned `uid=1654(app) gid=1654(app)`.
- Fresh local proof: `scripts/verify-storage.sh --local` exited 0 from 2026-10-09T09:02:31Z to 09:03:00Z. Captured output: `/private/tmp/cost-tracking-storage-proof.log`. The command regenerated `validation/storage-proof-early.md`; all seven local exercises passed. The container report's own clock is skewed from the host clock, so the host command timestamps above are authoritative for this execution.
- Operational script tests: `node --test scripts/*.test.mjs` passed **42/42** with loopback permission. The 3 new direct HTTP measurement tests cover the exact event fixture, rejection of failed HTTP/version/count responses, and the 2,000 ms/sample-count diagnostic assessment. Existing coverage includes 17-variant byte-roundtrip, loopback-only measurement bootstrap, failed journey accounting, redacted projection summaries, parity mismatch rejection, zero-byte empty-root handling, and 24-hour snapshot-age arithmetic.
- End-to-end local restore/replay: `scripts/verify-restore-replay.mjs --output validation/ops-restore-replay.json` passed against the frozen TestHost DLL. It restores into a fresh root without reseeding, compares 100-horse report aggregates (minor-unit amounts and stream version) and 550 pending income keys (digest), verifies the source hash/count is unchanged, and confirms a separate empty root is rejected without event bytes. This is local synthetic TestHost evidence only; Azure restore remains unverified.
- Earlier local equivalents for the CI application checks passed: locked .NET restore, .NET build, 253 backend tests excluding Azure SMB, npm locked install, frontend typecheck, lint, 64 unit tests, generated contracts, and production frontend build.
- The backend owner reports a later full solution build at 0 warnings/errors and 256/256 backend tests after the final event/API/TestHost changes. The Debug configuration is explicit in CI, matching the DLL path used by the local replay-verifier step. The ops worker did not rerun the shared backend suite or claim that CI itself has run.

The earlier 11/13 Playwright and 35-file formatting observations are superseded by the final frontend evidence in `frontend-journeys.md`: 21/21 browser journeys and the formatting check passed. Backend, contract, frontend, and local operational results are green in their recorded scopes. GitHub Actions itself has not been run, so this report makes no remote CI claim.

## Infrastructure limits

Bicep compilation and a local image build establish syntax and container buildability only. No resources were provisioned. The existing Azure Files account/share, effective Container Apps SMB mount options, two-client SMB semantics, DNS, Static Web Apps custom domain, WorkOS configuration, Key Vault authorization and key rotation, alert delivery, restore from an independent failure domain, and cloud billing are unverified. The aggregate log alert uses five fixed classes currently emitted by the API and covered by focused payload-free logging tests: `StorageLockTimeout`, `EventStreamUnreadable`, `EventReplayFailure`, `EventAppendFailure`, and `StorageUnavailable`. Its cloud query execution and notification delivery have not been exercised. `ProjectionSnapshotFailure` is a reserved future key and snapshots are not implemented, so that class cannot currently alert on any event.

The workflow needs no cloud credentials. It restores pinned dependencies and builds a local image but does not push or deploy. The local Docker-backed proof uses disposable local Linux storage; it does not stand in for an Azure Files proof.
