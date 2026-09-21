# Phase 0 Research

**Feature**: Horse Finance and Effort Tracking | **Date**: 2026-09-21

Inputs are the feature specification, architecture, constitution v1.1.0, and repository inspection. Research was split across authentication, storage, and domain-contract reviews. The repository has no application code or package manifests to preserve. Decisions below resolve technical design questions; operational proof is explicitly deferred to implementation/release validation.

## R1. Stack, dependencies, and canonical types

**Decision**: Keep the requested React 19/TypeScript/Vite/Tailwind/TanStack frontend and .NET 10 Minimal API. Use Node 24 LTS, strict TypeScript, and pinned compatible packages. Keep pure business logic in the API project's Domain folder. C# request/response records produce OpenAPI, then openapi-typescript produces frontend transport types. The event JSON Schema is the persisted compatibility contract; typed C# records must pass schema fixture tests. Do not maintain independent handwritten client domain models.

**Rationale**: The stack is an input requirement. Router handles the eight routes, Query handles authenticated server state and invalidation, WorkOS hosted AuthKit handles sign-in and the server broker handles refresh sessions, Tailwind handles styling, and Vite handles builds. JwtBearer handles token verification; built-in JSON, decimal, date, hashing, HTTP, and rate-limit primitives cover core needs. OpenAPI generation prevents manual transport drift. [ASP.NET OpenAPI](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/overview?view=aspnetcore-10.0), [openapi-typescript](https://openapi-ts.dev/introduction), [Vite requirements](https://vite.dev/guide/), [Node releases](https://nodejs.org/en/about/previous-releases).

**Alternatives considered**: A database, general event-sourcing framework, separate domain assembly, client state store, mediator, and generic repository add infrastructure or abstractions without a current requirement. Browser arithmetic would create a second domain implementation.

## R2. Behavior validation

**Decision**: xUnit for deterministic domain/contract tests; Microsoft.AspNetCore.Mvc.Testing for real HTTP pipeline integration; Vitest and Testing Library for component state/accessibility; Playwright for browser journeys. Use isolated temporary streams, fixed dates, deterministic IDs, and a local test-only JWT issuer. Use a separate opt-in suite on actual Azure Files. No arbitrary sleeps or assertions against private call order.

**Rationale**: Each test layer proves a different external behavior. Browser assertions wait for observable state, while the API test host substitutes external boundaries. [ASP.NET integration testing](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests?view=aspnetcore-10.0), [Vitest](https://vitest.dev/guide/), [Playwright assertions](https://playwright.dev/docs/test-assertions).

**Alternatives considered**: Only unit tests cannot prove auth/storage wiring; only browser tests make calendar and money edge cases unnecessarily slow. A production auth bypass would weaken the privacy boundary.

## R3. Exact allocation and previews

**Decision**: Equal mode divides integer minor units directly by horse count and gives residual units to ascending canonical UUID strings. Independently distribute millionth weight residues for display. Custom mode uses the exact integer weights, floors each quotient, then distributes remaining units by largest remainder, ties by UUID. Persist `splitMode` with allocations in financial events and rule defaults. Use checked integer arithmetic (BigInteger intermediates where multiplication can overflow) and decimal driving inputs; round once, half away from zero. Reject values/results outside the JSON safe-integer domain (absolute maximum 9,007,199,254,740,991).

**Rationale**: Allocating Equal money from rounded millionth weights is not equal for sufficiently large amounts: 300,000,000 units across three targets becomes 100,000,200 / 99,999,900 / 99,999,900. Direct n-way division yields 100,000,000 each. Stored mode makes replay/validation unambiguous. This is an inference from the supplied domain contract, not an external pricing/accounting recommendation.

**Decision**: Add authenticated, nonmutating `POST /previews/financial`. It runs the same validation and calculation functions as commit and returns exact allocation and monthly delta. The UI displays that response and formats amounts only; it does not reimplement allocation, rounding, recurrence, or P&L. Commit always revalidates current state.

**Alternatives considered**: Independent TypeScript calculations violate canonical-rule ownership. Inferring Equal mode from rounded weights confuses a legitimate Custom split with an Equal split. Restricting large amounts merely hides the error.

## R4. File integrity and durable acknowledgment

**Decision**: Keep JSONL on Azure Files SMB, but replace reliance on `FileShare.None` with explicit checked Linux locking on the open event-file handle. Use one local subject semaphore, open read/write without implicit exclusivity, then explicitly acquire exclusive nonblocking `flock`, inspect every result, bound contention retries, and fail closed for unsupported locking or I/O errors. Hold the handle and lock through tail recovery, idempotency lookup, version validation, replay, append, and `Flush(flushToDisk: true)`. Reads use the same subject guard for a consistent committed view. Never replace the event-stream inode during normal operation.

**Rationale**: .NET's Unix sharing lock is best effort and ignores some locking failures. The explicit native boundary is necessary for the specified integrity requirement; it is not proof of remote semantics. [Pinned .NET 10 source](https://raw.githubusercontent.com/dotnet/runtime/v10.0.0/src/libraries/System.Private.CoreLib/src/Microsoft/Win32/SafeHandles/SafeFileHandle.Unix.cs), [Flush documentation](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.flush?view=net-10.0).

**Deployment gate**: Record Linux kernel/runtime/image, SMB dialect and effective mount options. Reject `nobrl` and `nostrictsync`. Prove independent clients serialize, readers see committed changes, and acknowledged writes survive the fault scenarios in the storage contract. No claim is made that a managed mount supports this merely because the local API succeeds. If the proof fails, stop deployment and revise storage design. [Azure file locks](https://learn.microsoft.com/en-us/rest/api/storageservices/managing-file-locks), [Linux CIFS mount behavior](https://cdn.kernel.org/doc/html/latest/admin-guide/cifs/usage.html).

**Alternatives considered**: A local semaphore and `maxReplicas: 1` do not cover overlapping revisions or independent clients. Silent fallback to unlocked writes is unacceptable. A database or lease architecture is a separate design change.

## R5. Idempotency, snapshots, and recovery

**Decision**: Persist `commandHash` in the single event envelope alongside idempotency key. Hash the normalized command identity (method, route including resource IDs, canonical parsed request body; object keys sorted, decimals normalized, array order preserved); exclude token, transport whitespace, idempotency key and If-Match. Do not resolve current defaults before hashing. Look up key/hash before checking current version. Reconstruct original response from the event and state at that event version; return its original ETag even if newer writes exist. A changed command with the same key returns 409.

**Rationale**: Events containing normalized actual values cannot reconstruct whether the request omitted a driving rate or supplied it, or which command route it used. A durable hash closes that ambiguity without a second atomic file or a generic command log.

**Decision**: Preserve original bytes in a restricted recovery backup before truncating only an unterminated final line, flush the repair, and record operational recovery metadata outside the domain stream. Corrupt terminated lines, version gaps, wrong subjects, unknown event types or unsupported versions fail closed. Snapshots begin only after 5,000 events, at most once per subsequent 1,000 events, and only after storage proof. Validate prefix checksum, subject, schema, and version. Snapshot failure falls back to replay. Independent retained backups and restore exercises are mandatory. [Azure Files data protection](https://learn.microsoft.com/en-us/azure/storage/files/files-data-protection-overview).

**Alternatives considered**: A second idempotency file introduces a multi-file transaction. A snapshot without retained events or a backup on the same share cannot provide the required recovery assurance.

## R6. Query budgets and report completeness

**Decision**: Cap inclusive date windows at five calendar years and generated candidates at 10,000 across the whole request, before filtering/pagination. Return a clear 422; never silently truncate or reset the budget on each page. Income inbox adds optional `from` to `through` so old backlogs can be covered in explicit windows. If omitted, start at earliest rule start; excessive spans return a narrowing error. Stable cursors bind subject, filters, as-of date and stream version. Any intervening event requires a refreshed cursor.

**Decision**: Lifetime reporting is an as-of-today aggregate over all accepted history through that date. Compute internal nonoverlapping windows no larger than five years/10,000 candidates, combine exact totals at one captured stream version, and return additive cursor batches, each generating at most 10,000 candidates. Include `complete` and `nextCursor`; the UI folds each unique batch once at the same captured stream version/date and displays final lifetime totals only when complete. An intervening event invalidates the cursor and restarts accumulation. This preserves the hard per-request cap without truncating history.

**Rationale**: A lifetime endpoint without this rule conflicts with a five-year expansion cap. Pagination alone must not hide older pending receipts. One-month reports share the same expansion and aggregation pipeline as ledgers.

**Alternatives considered**: Truncating lifetime totals or pending sets would give incorrect answers. Persisting ordinary occurrences or scheduling materialization violates the feature.

## R7. WorkOS authentication and browser sessions

**Decision**: Use WorkOS hosted AuthKit through a small .NET session broker, not the client-only React SDK. The broker owns code/PKCE exchange, encrypted server-side refresh sessions, CSRF-protected refresh/logout, and a Secure/HttpOnly session-handle cookie. React holds only a short-lived access token in memory, preserving bearer authorization for the domain API. See [auth contract](contracts/auth.md). Use ordinary app-owned sibling frontend/API domains; include their registration/DNS cost in the budget.

**Rationale**: WorkOS's secure client-only React integration requires a custom authentication domain; the publicly listed custom-domain add-on is $99/month as checked on 2026-09-21. That conflicts with the supplied under-$5 target. Planning selects server-managed sessions to retain the budget objective. This avoids the add-on but does not prove the total hosting budget. [WorkOS React integration](https://workos.com/docs/authkit/react), [custom domains](https://workos.com/docs/custom-domains), [pricing](https://workos.com/pricing).

**Decision**: Use documented WorkOS authorization-code/refresh exchanges through typed HttpClient; no extra auth server or database. Encrypt mutable session files on the existing share, separately from financial events. Serialize refresh/logout using a stable session lock file; atomically replace encrypted session state after durable flush. Protect the shared Data Protection key ring with a secret-mounted certificate. A stable cookie handle avoids stale Set-Cookie responses overwriting newer refresh credentials. This concurrency choice is an engineering inference from rotating-token behavior. [WorkOS authentication](https://workos.com/docs/reference/authkit/authentication), [session resilience](https://workos.com/docs/authkit/session-resilience), [Data Protection configuration](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-10.0).

**Decision**: Configure WorkOS JWT template `aud` as an environment-specific API identifier; verify a real issued token. JwtBearer requires exact issuer/audience, HTTPS JWKS, signature and expiry, unmapped user `sub`. A JWKS URL is not an OIDC discovery document. Standard session claims do not promise `aud`; never assume client ID is the audience or use `org_id` as ownership. [WorkOS sessions](https://workos.com/docs/authkit/sessions), [JWT templates](https://workos.com/docs/authkit/jwt-templates), [ASP.NET JWT](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication?view=aspnetcore-10.0).

**Alternatives considered**: Paid client-only custom domain breaks the target absent an existing entitlement/exception; devMode stores tokens in localStorage and is rejected. Refresh tokens inside a rotating cookie have concurrent-response risks. A backend cookie authorizing all finance endpoints would require broader API/CSRF changes; the broker retains the specified bearer boundary. Test-only local JWT sessions support automated journeys; live hosted sign-in remains a staging smoke check. [WorkOS testing](https://workos.com/docs/authkit/testing).

## R8. Historical semantics and validation choices

**Decision**: Currency and time zone can change only before the first financial event (expense/income, either recurring-rule creation). Horse, task and driving-rate changes alone do not lock settings; changing currency before the first financial event clears the saved rate to avoid reinterpreting its currency units. New records/splits select currently Active/Leased horses; status changes do not silently rewrite existing rules, virtual expenses, overrides, or decisions. Existing rule obligations may be approved using their unchanged split after a horse becomes inactive; edited splits must select eligible horses. Label this distinction in the approval UI.

**Decision**: Initial rule revisions become effective on schedule start. Updates are full revisions with `effectiveFrom > ownerToday`, strictly later than any queued revision, and schedule start remains the original anchor. Reject changes that remove or change the applicable defaults of an already overridden future expense key; ask the owner to choose an effective date after the protected override. Stop dates are inclusive, at least today and rule start, and cannot remove an override/decision or contradict a queued revision. A stop is terminal; resuming requires a new rule. This keeps accepted history reproducible with one event per command.

**Decision**: Date-specific Changed overrides provide complete defaults; Skipped has null changed data. Income decisions require a due scheduled key, remain final, and use actual received date no later than today. One-time records can be future-dated and appear in the selected date interval; lifetime is explicitly as-of today. Income source is the source from the applicable immutable rule revision. `nextDueDate` is an audit hint, not the inbox cursor. Tasks require positive minutes or positive quantity with a nonempty unit; quantity-only tasks carry zero minutes.

**Rationale**: The feature requires historical retention and future-only rule changes. Rejecting destructive schedule changes is simpler than introducing detached override entities or implicit cancellation cascades. Explicit allowance for settling existing obligations avoids stranded payments when a horse is sold.

**Alternatives considered**: Silently deleting virtual history on status change, rewriting prior revisions, or materializing orphan occurrences would violate history/virtual-occurrence requirements. Arbitrarily changing account time zone after ledger creation could change reporting boundaries.

## R9. Deployment and cost evidence

**Decision**: Use a classic Azure storage-account file share with protected mount credentials, Container Apps Consumption minReplicas 0/maxReplicas 1 initially, and Static Web Apps Free. Document actual mount credential handling rather than asserting a managed-identity SMB mount. Take an independently retained backup and test restore into a fresh share. Restrict mount configuration and storage credentials to deployment/backend operators. [Container Apps mounts](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts), [Azure Files backup](https://learn.microsoft.com/en-us/azure/backup/azure-file-share-backup-overview).

**Decision**: Start the cost worksheet with a European region appropriate to the owner; choose the actual region and price it before provisioning. Include Files billing model, operations, capacity, backups, logs, registry, bandwidth, active container time, WorkOS plan entitlements, and ordinary DNS/domain cost. Treat shared free grants and an existing domain as explicit assumptions. Budget alerts do not cap spending. [Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [Files pricing](https://azure.microsoft.com/en-us/pricing/details/storage/files/), [Azure budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).

**Alternatives considered**: Quoting a guaranteed monthly total without a region, traffic forecast or authentication-domain quote is unsupported. Weakening backups or session security to fit an assumed budget is not an accepted exception.

## Resolution and remaining empirical gates

All planning questions have an explicit decision. Phase 1 can proceed. Still required before release: real WorkOS audience/session smoke test; Linux/SMB locking, flush, failover and restore evidence; measured warm/cold performance; usability study; dated regional estimate and observed usage. These are planned measurements, not unresolved contract semantics and not completed checks.
