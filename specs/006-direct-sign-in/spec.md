# U07: Direct sign-in

## Scope and user task

An existing owner choosing **Sign in** should reach the hosted sign-in screen directly, without first navigating a waitlist registration form. This follow-up is newly authorized after U07 was excluded from feature 005. U05 remains excluded.

## Acceptance criteria

- `GET /auth/login` redirects to the WorkOS AuthKit authorization endpoint with `screen_hint=sign-in`.
- Existing PKCE, state correlation, secure cookies, callback validation and allowed local return paths continue to work.
- The waitlist configuration and registration policy remain unchanged.
- After deployment, verify in a signed-out browser that **Sign in** opens the hosted login screen and an existing owner returns to the app after authentication.

## Validation

Extend the HTTP login/callback regression to assert the screen hint. Observe failure before adding the parameter, then run the backend suite. Hosted-screen behavior requires post-deployment verification; local tests assert the redirect protocol.

Reference: [WorkOS authorization URL API](https://workos.com/docs/reference/authkit/authentication/get-authorization-url).

Result: the login/callback regression failed because `screen_hint` was absent, then passed after adding `sign-in`. The full non-Azure-SMB backend suite passed: **302 tests** (`dotnet test backend/CostTracking.slnx --no-restore --filter 'Category!=AzureSmb' --disable-build-servers -m:1 -p:UseSharedCompilation=false`, .NET SDK 10.0.103). Hosted-screen verification remains pending deployment.
