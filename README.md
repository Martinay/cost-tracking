# Horse Finance and Effort Tracking

The application and local validation tooling are implemented; release readiness is not established. Current task acceptance and validation evidence are in `specs/001-horse-finance-effort-tracking/`.

## Pinned toolchain

- .NET SDK 10.0.103 / C# 14 (`global.json`), verified with `dotnet --info`.
- Node 24.19.0 (`.nvmrc`) and bundled npm 11.17.0, verified from the official archive SHA-256. This workstation's verified runtime is in the gitignored `.local/toolchain/node-v24.19.0-darwin-arm64/bin`; add it to `PATH` or use a compatible Node version manager.
- Linux containers run the native locking proof. The local two-process Linux proof and container build/runtime checks have passed; these do not establish Azure Files SMB semantics. See `specs/001-horse-finance-effort-tracking/validation/storage-proof-early.md` and `specs/001-horse-finance-effort-tracking/validation/ops-infra-ci.md` for current evidence and limits.

## Dependency purposes

ASP.NET JwtBearer validates signed access tokens; built-in OpenAPI generates typed API contracts. Microsoft.AspNetCore.Mvc.Testing hosts the actual HTTP pipeline; xUnit, its test runner and Microsoft.NET.Test.Sdk execute deterministic behavior tests. React renders accessible forms, TypeScript checks transport usage, Vite builds static assets, Tailwind provides styling, TanStack Router handles routes and Query handles subject-scoped server state. Vitest/Testing Library verify component behavior; Playwright checks running browser journeys; openapi-typescript generates transport types. ESLint/Prettier maintain consistent source formatting. Exact package versions and lockfiles are required; dependency restoration must succeed before setup is considered complete.

## Validation

Follow `specs/001-horse-finance-effort-tracking/quickstart.md` for local setup and checks. Current evidence: backend **256/256**, generated contracts **42/42** with no drift, frontend **68/68** with typecheck/lint/format/build passing, local operational scripts **42/42**, and HTTP-backed browser acceptance **21/21**, including the two-context income-decision race. Only the TestHost automation harness uses a 600 requests/minute budget; the production and ordinary API-test defaults remain 120. The 2026-10-16 local 100-horse/5,000-change run completed 400/400 browser journeys with all 2,200 proxied API requests returning HTTP 200, but warm p99 was 2,355.65 ms for the ledger and 2,856.13 ms for reports, above the 2,000 ms criterion. A separate 2026-10-17 direct HTTP run measured p99 of 734.07 ms for account, 772.89 ms for monthly reports, and 769.09 ms for lifetime reports; it used an uncontrolled host and is not journey or release-gate evidence. These runs do not pass T104 or establish target-region performance; the earlier 2026-10-10 run with 76 failed journeys remains preserved as separate history. See `specs/001-horse-finance-effort-tracking/validation/performance.md` and the release crosswalk for scope and limits. Detailed red/green evidence and run limits are in `specs/001-horse-finance-effort-tracking/validation/implementation.md`, `backend-acceptance.md`, `frontend-journeys.md`, and the ops notes; use the latest report before relying on a count.

Real WorkOS staging, Azure SMB durability/restore, the 20-person usability study, required-scale browser performance, and measured regional billing remain unverified gates. No paid resources were provisioned as part of local implementation.

## Azure deployment

`.github/workflows/ci.yml` runs the full validation suite for pull requests and `main`. Only an explicit manual run on `main`, after validation succeeds, reaches the serialized Azure deployment job. Pushes and pull requests run validation only. Azure authentication uses GitHub OIDC. Configure the protected `azure-production` GitHub environment, Azure role assignments, and required variables/secrets before manually running a deployment. The workflow reuses the API image and frontend build produced by validation, pushes the API by immutable digest to GHCR, and provisions Container Apps and Azure Files in Central India inside the existing `cost-tracking` resource group. Static Web Apps defaults to West Europe as the supported-region exception.

The first deployment leaves custom domains disabled because DNS is not yet configured. It reports generated hostnames and the API verification value; after adding DNS, enable custom domains and manually rerun the workflow. The example API and frontend domains are `api.cost-tracking.example.com` and `app.cost-tracking.example.com`; replace them with domains you control before deployment. Bicep provisions Azure Key Vault Data Protection with a managed identity and automatic key rotation; deployment permissions must include role assignment creation. See [infra/README.md](infra/README.md) for the GitHub/Azure setup, DNS sequence, certificate behavior, and readiness limits. Defining a deploy workflow does not establish that Azure resources were created or that release gates passed.

JsonSchema.Net validates the canonical draft-2020-12 event schema (including formats); System.Text.Json has no JSON Schema validator. The schema is embedded from its original specification path, not copied or rewritten.
