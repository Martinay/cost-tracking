# Local validation — 2026-11-10

## Workflow and acceptance
Spec Kit specify → plan/research → tasks → implement completed. Requirements checklist: 16/16 pass. All ten implementation tasks complete. No extension hooks are configured. Implementation checklist gate was read-only and passed before implementation.

Fresh accounts receive EUR/UTC at stream version zero with no configuration write. The integration journey adds a horse and records income/expense, returning EUR reports at stream version three. UI has no currency/timezone selections; driving-rate editing and ambiguous retry semantics remain covered. Explicit legacy settings continue replaying without conversion; supported IANA timezone requests remain accepted by the legacy API, while new non-EUR commands are rejected.

## Automated checks
- Pinned Node v24.19.0; dependencies installed with npm ci.
- Backend: 290/290 tests pass, including legacy projection replay, fresh-account financial commands, and rejecting USD/JPY/GBP configuration without appending events.
- Frontend: 78/78 tests across 17 files pass, including no setup controls, locked-account access, driving-rate ambiguous retry, and preserving date-only calendar dates.
- Frontend build/typecheck, ESLint and Prettier checks pass.
- Contract check: 42/42 tests pass; generated OpenAPI and TypeScript show no drift.
- Affected Playwright journeys: 14/14 pass (settings, private ledger, driving, language).
- git diff --check passes.

Regression evidence: before production changes, three backend default/EUR-policy tests failed as expected, as did both new settings component cases. After implementation they pass. Superseded dropdown/currency-change tests were replaced with applicable behavior assertions; historic currency replay tests remain.

## Running interface
Inspected full-page settings screenshots at desktop 1280px and mobile 375px. Explanatory text, driving editor, history and navigation fit without document overflow. German journeys pass at 1440px and 375px. First-use keyboard journey reaches Add horse immediately. Existing HTTP-backed driving and expense/report journeys pass with defaulted accounts.

Browser timezone contexts Europe/Berlin and America/New_York both display the same 2026-03-29T00:30:00Z event in local time (01:30 March 29 and 20:30 March 28 respectively), retaining the original datetime attribute. Date-only formatting remains unchanged. Screenshots inspected: /tmp/cost-defaults-1280-Europe-Berlin.png and /tmp/cost-defaults-375-America-New_York.png.

## Environment and limits
NuGet online vulnerability lookup was unavailable; restore used the existing local package cache with NuGetAudit=false. Local runner sockets and browser servers required sandbox escalation and then ran successfully. No dependency changes were made.

These are local implementation checks, not release readiness. Hosted WorkOS signup/staging, Azure SMB durability/restore, required-scale performance, usability study and regional billing gates from feature 001 remain outside this change. No deployment was performed.

## Merge with main — 2026-11-10

Merged origin/main at 93c46f2 into the feature branch. The only content conflict was in frontend/src/i18n/messages.ts; retained both the automatic ledger default translations and the expense-category driving hint. Main's category selector, horse identity assets, dependency update, and clickable horse-card behavior are retained.

Revalidated with pinned Node 24.19.0: npm ci, 83/83 frontend tests across 19 files, build/typecheck, ESLint, and Prettier pass. The 11 settings, language and horse-card browser journeys pass at desktop/mobile widths, in both interface languages and Berlin/New York timezone contexts. git diff --check passes. Backend implementation was unchanged by the merge; prior backend validation above remains the evidence for that slice.
