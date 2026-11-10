# Session renewal regression — 2026-11-10

Root cause: `GET /auth/session` returned 401 when only the access token had expired, preventing the frontend's missing-token refresh flow. Open pages also reused the original bearer token without recovery after an API 401.

The new backend expiry regression was observed failing (expected 200, actual 401) before the fix. The five initial frontend request-renewal tests were also observed failing before implementation.

The backend now returns a valid session's identity, expiry and CSRF token while omitting an expired access token. Absolute session expiry still returns 401. The browser shares renewal across requests and retries once with the original command descriptor; subject changes and logout prevent replay. Transient failures retain the mounted draft and expose session retry outside the hidden form. Terminal failures clear subject caches and offer sign-in.

Local validation with .NET 10.0.103 and Node 24.19.0:

- Backend regression suite excluding Azure SMB: 291/291 passed, including 27 session broker cases.
- Frontend component suite: 92/92 passed, including nine renewal cases for command replay, concurrent/late responses, retryable failure, account switching, logout, draft recovery and terminal failure.
- Generated contracts: 42/42 passed; generated OpenAPI/TypeScript had no drift.
- Frontend build, lint and format checks passed.
- Browser suite: 33/33 passed. The renewal journey forces expiry during navigation to settings, saving a driving rate and saving a horse; all three recover without sign-in, and both retried writes preserve their body/key/version.

Browser renewal responses in that journey are mocked; session expiry and refresh are separately exercised through the real backend HTTP test host. This is local regression evidence, not real WorkOS staging, Azure session persistence or release-readiness evidence.


## PR review repair — financial draft retention

Review identified that route guards still unmounted financial editors when auth readiness became false. The original unconditional-input regression did not exercise those guards. Three new route-level regressions were observed failing before repair: Expense, Income and Driving each restored an empty amount/distance after session retry.

Editor render guards now follow the retained subject, including recurring editor sections. Protected query `enabled` conditions still require auth readiness, and AppShell still hides/inerts the retained content during recovery. The new tests fill real forms, obtain a server preview, force a transient renewal failure, retry the session and verify fields, horse selection and the original preview remain available without another preview request. Each test then verifies terminal renewal failure removes the financial form and clears private caches.

Validation: 95/95 frontend tests passed; frontend build, lint and formatting passed; all 14 affected financial browser journeys passed. No backend code or financial calculations changed. These checks do not establish real WorkOS staging or release readiness.
