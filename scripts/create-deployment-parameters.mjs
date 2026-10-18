import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const required = [
  "NAME_PREFIX",
  "GHCR_USERNAME",
  "GHCR_TOKEN",
  "API_IMAGE",
  "APP_DOMAIN",
  "API_DOMAIN",
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "AUTH_ISSUER",
  "AUTH_AUDIENCE",
  "AUTH_JWKS_URL",
  "OPERATIONS_EMAIL",
];

export function buildParameters(env) {
  const missing = required.filter((key) => !env[key]);
  if (missing.length)
    throw new Error(`Missing deployment configuration: ${missing.join(", ")}`);

  if (!/^[a-z0-9-]{3,30}$/.test(env.NAME_PREFIX))
    throw new Error(
      "NAME_PREFIX must be 3-30 lowercase letters, digits, or hyphens.",
    );
  if ((env.LOCATION ?? "centralindia") !== "centralindia")
    throw new Error("LOCATION must be centralindia.");
  const staticWebAppLocation = env.STATIC_WEB_APP_LOCATION ?? "westeurope";
  if (
    !["westus2", "centralus", "eastus2", "westeurope", "eastasia"].includes(
      staticWebAppLocation,
    )
  )
    throw new Error(
      "STATIC_WEB_APP_LOCATION must be a supported Static Web Apps region.",
    );
  if (
    env.STORAGE_ACCOUNT_NAME &&
    !/^[a-z0-9]{3,24}$/.test(env.STORAGE_ACCOUNT_NAME)
  )
    throw new Error(
      "STORAGE_ACCOUNT_NAME must be 3-24 lowercase letters or digits.",
    );
  const fileShareQuotaGiB = Number(env.FILE_SHARE_QUOTA_GIB ?? "10");
  if (
    !Number.isInteger(fileShareQuotaGiB) ||
    fileShareQuotaGiB < 1 ||
    fileShareQuotaGiB > 5120
  )
    throw new Error("FILE_SHARE_QUOTA_GIB must be an integer from 1 to 5120.");
  if (
    !/^ghcr\.io\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/.test(
      env.API_IMAGE,
    )
  )
    throw new Error(
      "API_IMAGE must be an immutable registry image reference on ghcr.io pinned by sha256 digest.",
    );
  if (!["true", "false"].includes(env.ENABLE_CUSTOM_DOMAINS ?? "false"))
    throw new Error("ENABLE_CUSTOM_DOMAINS must be true or false.");
  const apiMinReplicas = env.API_MIN_REPLICAS ?? "0";
  if (!["0", "1"].includes(apiMinReplicas))
    throw new Error("API_MIN_REPLICAS must be 0 or 1.");
  if (env.APP_DOMAIN === env.API_DOMAIN)
    throw new Error("APP_DOMAIN and API_DOMAIN must be distinct hostnames.");

  const values = {
    namePrefix: env.NAME_PREFIX,
    location: env.LOCATION ?? "centralindia",
    staticWebAppLocation,
    ...(env.STORAGE_ACCOUNT_NAME
      ? { storageAccountName: env.STORAGE_ACCOUNT_NAME }
      : {}),
    ...(env.FILE_SHARE_NAME ? { fileShareName: env.FILE_SHARE_NAME } : {}),
    ...(env.FILE_SHARE_QUOTA_GIB ? { fileShareQuotaGiB } : {}),
    ghcrUsername: env.GHCR_USERNAME,
    ghcrToken: env.GHCR_TOKEN,
    apiImage: env.API_IMAGE,
    appDomain: env.APP_DOMAIN,
    apiDomain: env.API_DOMAIN,
    enableCustomDomains: env.ENABLE_CUSTOM_DOMAINS === "true",
    ...(env.API_MIN_REPLICAS ? { apiMinReplicas: Number(apiMinReplicas) } : {}),
    workOsClientId: env.WORKOS_CLIENT_ID,
    workOsApiKey: env.WORKOS_API_KEY,
    authIssuer: env.AUTH_ISSUER,
    authAudience: env.AUTH_AUDIENCE,
    authJwksUrl: env.AUTH_JWKS_URL,
    operationsEmail: env.OPERATIONS_EMAIL,
  };

  return {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, { value }]),
    ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const targetPath = process.argv[2];
  if (!targetPath)
    throw new Error(
      "Usage: node scripts/create-deployment-parameters.mjs <output-file>",
    );
  await writeFile(targetPath, JSON.stringify(buildParameters(process.env)), {
    mode: 0o600,
    flag: "wx",
  });
}
