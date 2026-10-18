# Azure infrastructure and deployment

`main.bicep` provisions the .NET API on Container Apps, a dedicated Standard LRS storage account and SMB file share, the Azure Files mount, Log Analytics, and operational alerts. Regional resources use **Central India** (`centralindia`). Static Web Apps is the agreed exception: it defaults to **West Europe** (`westeurope`) because Central India is unsupported, and its static assets are globally distributed. Azure Monitor action groups and metric alerts use the required `global` location.

The GitHub Actions workflow deploys only on an explicit manual run on `main`, after validation succeeds. Pushes and pull requests run validation only. It publishes the validated API image to **GitHub Container Registry (GHCR)** and deploys application resources inside the existing `cost-tracking` resource group. No ACR or registry role assignments are required. Bicep creates a Key Vault and RSA key for Data Protection, rotates the key yearly, and grants the API's system-assigned identity the built-in Key Vault Crypto Service Encryption User role at the individual key scope. DNS, WorkOS, and an independent backup target remain operator-managed. Local validation does not provision Azure resources.

## Infrastructure files

| File                                                                                       | Purpose                                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [main.bicep](main.bicep)                                                                   | Azure resources, application configuration, storage mount, and alerts  |
| [parameters.example.json](parameters.example.json)                                         | Placeholder parameters for an operator-managed deployment              |
| [../.github/workflows/ci.yml](../.github/workflows/ci.yml)                                 | Validation, image publishing, Azure deployment, and frontend upload    |
| [../scripts/create-deployment-parameters.mjs](../scripts/create-deployment-parameters.mjs) | Validates workflow configuration and writes protected Bicep parameters |
| [storage-proof.compose.yml](storage-proof.compose.yml)                                     | Independent SMB clients for the opt-in Azure Files proof               |
| [backup-restore.md](backup-restore.md)                                                     | Independent backup and restore procedure                               |

## GitHub Actions deployment setup

Before enabling the workflow, confirm that resource group `cost-tracking` exists in Central India. Bicep creates and manages the dedicated storage account and file share. The account name defaults to `ct` plus a deterministic hash of the resource group ID, so it stays stable across deployments to the same resource group. The share name defaults to `ledger`. The default share quota is 10 GiB, with a capacity alert at 8 GiB and seven-day share soft deletion. Soft deletion does not replace independent backups. Redeploying reconciles the configured storage settings, so retain the account/share names to preserve access to existing data. If an earlier deployment used explicit names, preserve those names as Bicep parameter defaults before redeploying; generating a different account name does not migrate its data.

Create a GitHub environment named `azure-production`, restrict its deployment branch to `main`, and configure required reviewers before storing the configuration below. Configure Microsoft Entra workload identity federation with subject `repo:<OWNER>/<REPOSITORY>:environment:azure-production` and audience `api://AzureADTokenExchange`. Grant the deployment principal **Contributor** on `cost-tracking` and **Role Based Access Control Administrator** on that resource group so Bicep can create the API identity's scoped role assignment. Contributor alone cannot write role assignments. This built-in role administrator can grant roles only within its scope; a custom role with `Microsoft.Authorization/roleAssignments/read`, `write`, and `delete` at the resource group can be used if your access policy requires narrower deployment permissions. Azure login uses GitHub OIDC.

Add these GitHub **environment variables**:

| Variable                  | Value                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`         | Entra application/service principal client ID used for OIDC                       |
| `AZURE_TENANT_ID`         | Entra tenant ID                                                                   |
| `AZURE_SUBSCRIPTION_ID`   | Subscription containing the resource group                                        |
| `STATIC_WEB_APP_LOCATION` | Optional supported Static Web Apps region; defaults to `westeurope`               |
| `GHCR_USERNAME`           | GitHub account with read access to the API package                                |
| `APP_DOMAIN`              | `app.cost-tracking.example.com`                                                  |
| `API_DOMAIN`              | `api.cost-tracking.example.com`                                                  |
| `ENABLE_CUSTOM_DOMAINS`   | Initially `false`; change to `true` only after configuring both DNS records below |
| `WORKOS_CLIENT_ID`        | WorkOS client ID                                                                  |
| `AUTH_ISSUER`             | Exact token issuer URL                                                            |
| `AUTH_AUDIENCE`           | Exact API token audience                                                          |
| `AUTH_JWKS_URL`           | Exact JWKS URL                                                                    |
| `OPERATIONS_EMAIL`        | Alert recipient                                                                   |

Add these GitHub **environment secrets**:

| Secret                                          | Value                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `GHCR_TOKEN`                                    | Classic PAT with `read:packages` for runtime image pulls                  |
| `WORKOS_API_KEY`                                | WorkOS API key                                                            |

The workflow writes Bicep parameters to a mode-600 temporary file, removes that file after deployment, and never commits it. Static Web Apps deployment credentials are read from Azure at deploy time and masked in the Actions log.

The workflow fixes `AZURE_RESOURCE_GROUP=cost-tracking`, `NAME_PREFIX=cost-tracking`, and `LOCATION=centralindia`. This creates Container App `cost-tracking-api`, Container Apps environment `cost-tracking-env`, Static Web App `cost-tracking-web`, and Log Analytics workspace `cost-tracking-logs`. These are workflow settings, not GitHub environment variables to configure.

The validation job builds the frontend with `VITE_API_BASE_URL=https://api.cost-tracking.example.com`. Replace this example with your own API hostname before deployment. Changing `API_DOMAIN` also requires updating that build setting in the workflow; the deployment job uploads the already validated frontend without rebuilding it. Keep `APP_DOMAIN`, WorkOS settings, and DNS consistent with the chosen hostnames.

The workflow publishes `ghcr.io/<owner>/<repository>/cost-tracking-api:sha-<commit>` using its short-lived `GITHUB_TOKEN` and `packages: write` permission, then deploys the immutable digest. Ensure the package grants this repository's Actions workflows write access if it already exists. Container Apps uses a separate classic PAT (`GHCR_TOKEN`) with `read:packages`, owned by `GHCR_USERNAME`, for future image pulls after the workflow token expires. The account must have access to the package; authorize SSO if the organization requires it. See [GitHub's container registry authentication guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry).

Storage keys are obtained by Bicep through `listKeys()` and passed directly to the mount; no storage key is configured in GitHub or emitted as an output. The WorkOS API key is the only application secret. Data Protection uses a versionless Key Vault key URI, stored in Container Apps as `Auth__DataProtectionKeyIdentifier`; the API authenticates to Key Vault with its system-assigned identity. The vault uses Azure RBAC, soft-delete, and purge protection. Its RSA-2048 key permits wrap and unwrap operations and rotates yearly without setting an expiry on key versions. This leaves prior versions enabled and available for key-ring XML encrypted by them; retire old versions only after proving no persisted key-ring entry still references them.

The new vault and key are created with the app deployment. Key Vault RBAC assignment can take time to propagate after deployment, so the first Data Protection or authentication operation can fail during that window. Retry the operation, or restart the revision after access becomes effective. Confirm the key's rotation policy and API health in Azure after the first deployment. Key Vault and cryptographic operation charges depend on region, tier, and request volume; include them in the measured service budget. Purge protection prevents immediate permanent deletion and cannot be disabled once enabled.

No GitHub variables are needed for storage names, share quota, or minimum replicas. Bicep defaults to the generated account name, share `ledger`, a 10 GiB quota, and zero minimum API replicas. Direct Bicep deployments can override `storageAccountName`, `fileShareName`, `fileShareQuotaGiB` (1–5120), and `apiMinReplicas` (0 or 1). The capacity alert threshold is a separate Bicep parameter, `fileCapacityAlertBytes`, which defaults to `8589934592` (8 GiB). The workflow parameter generator does not expose an override for it. If you change the share quota, review the threshold in `main.bicep` as well so the alert leaves useful capacity headroom.

## First deployment and DNS

Run the workflow with `ENABLE_CUSTOM_DOMAINS=false`. It publishes the API image to GHCR, deploys the app and Static Web App, and reports the Azure-generated hostnames and API verification value in the workflow summary. The frontend is built with the requested API hostname, so the app is not ready for normal sign-in until DNS and custom domain binding are complete.

If records are managed directly in the `example.com` zone, create these records:

| Type  | Host                      | Value                                                                                                  |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| CNAME | `app.cost-tracking`       | Static Web App default hostname from the first workflow summary                                        |
| CNAME | `api.cost-tracking`       | Container App default hostname from the first workflow summary, directly (no proxy/intermediate CNAME) |
| TXT   | `asuid.api.cost-tracking` | API domain verification value from the first workflow summary                                          |

If `cost-tracking.example.com` is a separately delegated DNS zone, use hosts `app`, `api`, and `asuid.api` in that zone instead.

After DNS resolves publicly, set `ENABLE_CUSTOM_DOMAINS=true` and manually dispatch the workflow on `main`. The workflow warms the API, registers the API hostname before certificate binding, then Bicep binds the Container Apps managed certificate and Static Web App custom domain. Keep this variable true for later deployments so Bicep retains those bindings. Certificate issuance is asynchronous and must be confirmed in Azure; this workflow cannot prove certificate readiness or DNS propagation locally. Azure's managed certificate guidance requires public ingress, a direct CNAME, and a running app during issuance and renewal. The workflow temporarily raises minimum replicas to one while setting up the custom host; Bicep then restores the default of zero minimum replicas. Overriding `apiMinReplicas` to one has ongoing compute cost, while scale-to-zero behavior and certificate renewal should be confirmed against the deployed app before relying on the certificate lifecycle.

The initial deployment is only infrastructure and an app shell. WorkOS callback settings must use `https://api.cost-tracking.example.com/auth/callback`, and the WorkOS app must allow the frontend origin `https://app.cost-tracking.example.com`. Confirm HTTPS, Key Vault authorization and key rotation, sign-in, API connectivity, remote Azure Files behavior, restore evidence, performance, and billing independently before treating the service as release-ready.

## Build the API image

Run from the repository root:

```sh
docker build --file backend/Dockerfile --tag cost-tracking-api:local .
```

The Dockerfile pins .NET SDK `10.0.103` and runtime `10.0.3`, restores the API using its committed NuGet lock file, embeds the canonical event schema, and runs as the runtime image's non-root UID/GID `1654`. Ledger and Data Protection key-ring data live under `/data` on the mounted share. The API wraps persisted Data Protection keys with the versionless Azure Key Vault RSA key and uses its managed identity for wrap/unwrap operations. Use an immutable registry reference with `@sha256:<digest>` for the deployed `apiImage` parameter. The local tag is only for build and smoke checks.

## Inputs and protected configuration

Copy `parameters.example.json` to an operator-controlled secret store and replace every `DO-NOT-USE` value. Never commit the resulting file. Keep the storage defaults unless targeting an existing account/share, and supply the GHCR username and read token, WorkOS client/API credentials, exact issuer/audience/JWKS URL, app-owned sibling domains, and an operations email. Bicep enforces `StorageV2`, `Standard_LRS`, SMB, and the configured share quota. Existing accounts must already be compatible with these settings and Central India; changing the region does not migrate existing data. The secure Bicep parameters are marked `@secure()` and are not emitted as outputs.

The Container Apps storage link requires an account key for Azure Files SMB. Bicep retrieves this key directly from the dedicated account. Limit account access to deployment operators and expose the mount only to the API container. The app runs under UID/GID `1654`; mount options set explicit identity/modes and `vers=3.0`. No `nobrl` or `nostrictsync` option is set. The effective mounted options still require the designated two-client SMB proof before release.

The app and API custom domains must be subdomains of the same owner-controlled registrable domain (for example, `app.example.com` and `api.example.com`) so the session cookie remains same-site. Create direct DNS records required by Static Web Apps and Container Apps managed certificates before deployment. The `.test` example values are placeholders and cannot issue certificates or authenticate with WorkOS. Register the exact callback URL `https://<api-domain>/auth/callback` and configured logout/redirect URLs with WorkOS.

The API uses Consumption with 0.5 vCPU and 1 GiB memory per replica. Minimum replicas default to zero and can be set to one with Bicep parameter `apiMinReplicas`; the maximum is always one. The single replica limit is a cost choice, not an integrity mechanism; SMB locking is still a release gate. The Static Web App uses the Free SKU. Container and storage billing, backups, logs, WorkOS entitlements, region, and domain costs remain to be measured before accepting the under-$5 target.

## Monitoring and known readiness gates

The template uses 30-day Log Analytics retention and a 1 GB/day ingestion cap. It creates an operations email action group, a `FileCapacity` alert, and an aggregate-only log query for the fixed classes `StorageLockTimeout`, `EventStreamUnreadable`, `EventReplayFailure`, `EventAppendFailure`, and `StorageUnavailable`. These five classes are emitted by the API and covered by focused payload-free logging tests; query execution and action-group delivery still require deployment evidence. The query also reserves `ProjectionSnapshotFailure` for a future snapshot implementation; it remains silent until that exact class is emitted. Query results contain only a count and the alert metadata has fixed labels. Azure Files `FileCapacity` is refreshed on an hourly schedule and may lag, so it cannot replace capacity headroom checks.

The current domain API has no health endpoint dedicated to ingress probes. The container uses a TCP liveness probe on port 8080. No alert can certify that remote SMB locking, durable flush, independent backup, workload latency, human usability, or billing targets pass. Capture those separately using `specs/001-horse-finance-effort-tracking/validation/` evidence.

## Local validation

If the Azure CLI Bicep extension is installed, validate locally from the repository root:

```sh
az bicep build --file infra/main.bicep --outfile /private/tmp/cost-tracking-main.json
docker build --file backend/Dockerfile --tag cost-tracking-api:local .
```

CI pins Bicep CLI `v0.48.1` and builds the API image with `--platform linux/amd64`. Use the same version and platform when reproducing CI locally. Docker must be running for the image build.

These commands do not create Azure resources. The GitHub Actions workflow deploys only after validation succeeds on an explicit manual run on `main`; configure its `azure-production` environment before enabling that job. Bicep compilation proves syntax and schema only; it cannot prove resource availability, DNS, WorkOS, mount options, costs, or actual restore behavior.

For backup and restore procedure, use [backup-restore.md](backup-restore.md). For cross-client lock evidence, use `scripts/verify-storage.sh --azure` only with the designated synthetic Azure Files share and approved credentials. Set `STORAGE_PROOF_STORAGE_ACCOUNT`, `STORAGE_PROOF_STORAGE_KEY`, `STORAGE_PROOF_FILE_SHARE`, `STORAGE_PROOF_MOUNT_OPTIONS`, `STORAGE_PROOF_SHARE_SKU`, and `STORAGE_PROOF_BILLING_MODEL` in the proof runner's environment. The runner requires an explicit SMB 3.x `vers=` option and rejects `nobrl` and `nostrictsync`; missing configuration exits with an `UNPROVEN` result. See the [storage proof contract](../specs/001-horse-finance-effort-tracking/contracts/storage.md#deployment-proof-gate) for the full release gate.
