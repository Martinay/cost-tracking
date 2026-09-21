# Authentication Contract

Use WorkOS hosted AuthKit with a small .NET session broker. This replaces the proposed client-only React AuthKit SDK because its secure custom-auth-domain requirement conflicts with the under-$5 target. React keeps the returned access token only in memory; `/api/v1/*` continues accepting only fully validated bearer tokens. Never use the session cookie as domain-API authorization.

## Endpoints outside `/api/v1`

| Endpoint | Behavior |
|---|---|
| `GET /auth/login?returnTo=/horses` | Create random correlation state and PKCE S256 verifier; place in short-lived protected HttpOnly correlation cookie; redirect to WorkOS authorization URL with provider authkit. Return path must be allowlisted app-relative route. |
| `GET /auth/callback?code=...&state=...` | Validate correlation/state and expiry, clear correlation cookie, exchange code using server-held client secret and verifier, validate JWT, create session, redirect to configured frontend origin plus allowed return path. Code/state must never be logged. |
| `GET /auth/session` | Cookie-authenticated `200 {user:{id},accessToken?,expiresAt,csrfToken}`; omit expired token. No refresh side effect. Missing/expired session → 401. |
| `POST /auth/refresh` | Require cookie, exact allowed Origin and antiforgery header; exchange refresh token server-side under session lock; persist rotation before returning `{user:{id},accessToken,expiresAt}`. If another request already refreshed the token, return that current valid token. |
| `POST /auth/logout` | Require Origin/antiforgery; invalidate local session, expire cookie and return allowlisted WorkOS logout URL. Browser clears subject data and navigates there. |

All auth responses use Cache-Control no-store. API CORS allows only configured frontend origin; auth requests include credentials. Use app-owned sibling HTTPS domains (`app.example.com`, `api.example.com`) so cookies are same-site; the ordinary domain cost belongs in the budget. Do not depend on third-party cookies across unrelated default Azure domains or purchase a WorkOS custom domain for this flow.

## Session state and refresh concurrency

Use an opaque cryptographically random session handle in `__Host-cost-session` cookie: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. Store a hash of that handle as the filename under a separate `/data/auth/sessions/` directory. Encrypt session payload `{sub,sid,accessToken,refreshToken,expiresAt,absoluteExpiry}` using ASP.NET Data Protection. Session state is mutable authentication infrastructure, never a financial event or report input.

Refresh/logout acquire a checked cross-process lock on a stable separate session lock file before reading session state. Under the lock, refresh only if needed, write encrypted replacement to a same-directory temporary file, flush and replace, then respond. Do not lock the replaced session file's inode. Unsupported locking fails closed. Concurrent refresh requests reuse the already rotated token. Session loss fails safely to sign-in; never recover a financial account by accepting an unverified subject.

Persist Data Protection key ring separately on the share with fixed application name and certificate encryption; mount the certificate/private key through an application secret, not the same publicly readable location. Retain old decrypting certificates for rotation. Neither keys nor tokens enter source control, telemetry, browser storage, or financial backups intended for ledger inspection. Expired session cleanup can be opportunistic on auth access; no cron is introduced.

Transient refresh/network/429/5xx errors keep the session/draft and return retryable failure. Terminal invalid grant removes the session and requires sign-in. A refresh exchange followed by lost response is tested against WorkOS's rotation/replay behavior; a failure outside its grace period may require sign-in, never duplicate a financial command.

## JWT boundary

Configure an environment-specific audience using WorkOS JWT template, and verify a real issued token before release. Set exact issuer/audience, signed-token and expiry requirements, unmapped `sub` and accepted signing algorithm. Accept only user subjects. Use HTTPS client-specific JWKS with cached rotation-aware key retrieval; a JWKS URL is not an OIDC discovery document and must not be used as one. `org_id` never changes ownership. No WorkOS SDK is necessary solely for JWT validation; typed HttpClient handles documented server exchanges.

Tests: wrong signature/issuer/audience, missing audience, expired token, absent/non-user subject, rotation/unknown signing key, rejected code/state, open-redirect attempt, missing/wrong Origin/CSRF, two concurrent refreshes, refresh persistence failure, logout race, new user after sign-out, and no token in localStorage. Test-only issuer/keys are registered only in test hosting; production fails startup if test-auth configuration is selected. Real hosted sign-in/logout is a manual staging smoke check.

Source rationale and alternatives are in [research.md R7](../research.md#r7-workos-authentication-and-browser-sessions).
