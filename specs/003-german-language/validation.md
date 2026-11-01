# Local validation — 2026-11-01

## Scope and environment

Node 24.19.0 from the README-pinned local runtime, locked frontend dependencies restored offline. Existing .NET 10.0.103 synthetic TestHost and Chromium. No live authentication credentials or production data used. No backend contracts or financial rules changed.

## Tests-first evidence

- Initial language tests failed because the provider and selector did not exist; after implementation selection, persistence, document language, unknown-message fallback and blocked/corrupt storage tests passed.
- German task, schedule and currency tests failed on missing German labels and English report formatting before translation. They now verify canonical task/weekday values, German validation/success and preserved drafts.
- Known-error/date tests failed on missing behavior before implementing localized recovery and day-preserving date formatting.
- Regression tests exposed unknown prototype-like keys and route-specific error recovery; catalogue lookup now checks own keys and preserves route-specific messages.
- Browser regression proved German horse cards fell back to block layout because styling selected an English accessible label. Stable horse-grid styling restores the same cards in both languages.
- Browser report acceptance exposed selector overflow at 320px/200% zoom; selector wrapping now preserves the existing no-document-overflow check.
- New browser checks verify signed-out persistence, all main German routes, settings freeze independence, untouched user content, locale currency and inline financial preview/draft preservation, plus language selection inside a horse dialog at 1440px and 375px.

## Results before integration with latest main

- Frontend tests: 77/77 passed.
- Browser suite: 24/24 passed, including existing HTTP-backed ledger, account isolation, recurring expense, income-decision race and report journeys; new German scenarios use deterministic intercepted transport.
- Desktop/mobile task screenshots inspected at 1440px and 375px: readable labels, focus visibility, wrapping account controls and no document overflow.
- Build, lint and formatting passed during development; final integrated checks recorded below.

## Final integrated results

Integrated main commit 15d3c79 (time-zone dropdown), preserving the worldwide zone options and identifiers and translating its label/placeholder. Two inherited AuthBoundary tests still treated the new dropdown as a text input; changed only those interactions to selectOptions, preserving their command-header/idempotency assertions.

- `npm --prefix frontend run build`: passed (TypeScript and Vite production build).
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run format:check`: passed.
- `npm --prefix frontend test -- --run`: 83/83 passed across 17 files.
- `E2E_SKIP_BUILD=1 npm --prefix frontend run test:e2e`: 26/26 passed, including the integrated desktop/mobile time-zone scenarios. TestHost was built earlier with the pinned .NET SDK; backend code was unchanged by integration.
- Browser checks include 1440px/375px German routes, inline financial preview and dialog draft preservation, stable horse cards, and existing 320px/200% zoom report overflow checks.
- `git diff --check`: passed.

The localhost test processes needed sandbox permission to bind ports. All testing remained local and synthetic. CI results and PR merge state are reported separately in the chat/PR, not inferred from these checks.

## Limits

Local UI, synthetic HTTP journeys and CI do not establish release readiness. Real WorkOS staging, Azure SMB/restore, target-scale performance, usability study and billing gates in specs/001-horse-finance-effort-tracking remain separate. User content, stored historical summaries, hosted authentication pages and unknown server diagnostics retain their original language.
