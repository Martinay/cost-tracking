import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildParameters } from "./create-deployment-parameters.mjs";
import { isTrustedDeployment } from "./deployment-policy.mjs";

function validEnvironment() {
  return {
    NAME_PREFIX: "cost-tracking",
    LOCATION: "centralindia",
    STORAGE_ACCOUNT_NAME: "trackingfiles",
    FILE_SHARE_NAME: "ledger",
    GHCR_USERNAME: "package-reader",
    GHCR_TOKEN: "package-read-token",
    API_IMAGE: `ghcr.io/example/cost-tracking-api@sha256:${"a".repeat(64)}`,
    APP_DOMAIN: "app.cost-tracking.example.com",
    API_DOMAIN: "api.cost-tracking.example.com",
    ENABLE_CUSTOM_DOMAINS: "false",
    WORKOS_CLIENT_ID: "client-id",
    WORKOS_API_KEY: "workos-secret",
    AUTH_ISSUER: "https://issuer.example",
    AUTH_AUDIENCE: "cost-tracking",
    AUTH_JWKS_URL: "https://issuer.example/jwks",
    OPERATIONS_EMAIL: "ops@example.test",
  };
}

test("first deployment leaves custom domains disabled and preserves secure parameters", () => {
  const parameters = buildParameters(validEnvironment()).parameters;

  assert.equal(parameters.enableCustomDomains.value, false);
  assert.equal(parameters.apiImage.value, validEnvironment().API_IMAGE);
  assert.equal(parameters.ghcrToken.value, "package-read-token");
  assert.equal(parameters.workOsApiKey.value, "workos-secret");
  assert.equal("dataProtectionCertificateBase64" in parameters, false);
  assert.equal("dataProtectionCertificatePassword" in parameters, false);
  assert.equal("previousDataProtectionCertificateBase64" in parameters, false);
  assert.equal(
    "previousDataProtectionCertificatePassword" in parameters,
    false,
  );
});

test("Data Protection deployment does not require or emit any PFX secrets", () => {
  const env = validEnvironment();
  for (const key of [
    "DATA_PROTECTION_CERTIFICATE_BASE64",
    "DATA_PROTECTION_CERTIFICATE_PASSWORD",
    "PREVIOUS_DATA_PROTECTION_CERTIFICATE_BASE64",
    "PREVIOUS_DATA_PROTECTION_CERTIFICATE_PASSWORD",
  ]) {
    delete env[key];
  }

  const { parameters } = buildParameters(env);
  for (const key of [
    "dataProtectionCertificateBase64",
    "dataProtectionCertificatePassword",
    "previousDataProtectionCertificateBase64",
    "previousDataProtectionCertificatePassword",
  ]) {
    assert.equal(key in parameters, false, `${key} must not be emitted`);
  }
});

test("custom domains can be enabled explicitly after DNS setup", () => {
  const env = { ...validEnvironment(), ENABLE_CUSTOM_DOMAINS: "true" };
  assert.equal(buildParameters(env).parameters.enableCustomDomains.value, true);
});

test("deployment without storage or replica variables uses Bicep defaults", () => {
  const env = validEnvironment();
  delete env.STORAGE_ACCOUNT_NAME;
  delete env.FILE_SHARE_NAME;
  const { parameters } = buildParameters(env);
  for (const key of [
    "storageAccountName",
    "fileShareName",
    "fileShareQuotaGiB",
    "apiMinReplicas",
  ]) {
    assert.equal(key in parameters, false, `${key} must use its Bicep default`);
  }
});

test("explicit storage and replica overrides remain available for existing deployments", () => {
  const { parameters } = buildParameters({
    ...validEnvironment(),
    FILE_SHARE_QUOTA_GIB: "20",
    API_MIN_REPLICAS: "1",
  });
  assert.equal(parameters.storageAccountName.value, "trackingfiles");
  assert.equal(parameters.fileShareName.value, "ledger");
  assert.equal(parameters.fileShareQuotaGiB.value, 20);
  assert.equal(parameters.apiMinReplicas.value, 1);
});

test("preflight rejects missing protected settings and mutable image tags", () => {
  const missing = validEnvironment();
  delete missing.GHCR_TOKEN;
  assert.throws(() => buildParameters(missing), /GHCR_TOKEN/);

  const mutable = {
    ...validEnvironment(),
    API_IMAGE: "ghcr.io/example/cost-tracking-api:latest",
  };
  assert.throws(
    () => buildParameters(mutable),
    /immutable registry image reference/,
  );
});

test("parameter file writes are exclusive and owner-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cost-tracking-deploy-"));
  const file = join(directory, "parameters.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, JSON.stringify(buildParameters(validEnvironment())), {
    mode: 0o600,
    flag: "wx",
  });

  const stored = JSON.parse(await readFile(file, "utf8"));
  const mode = (await stat(file)).mode & 0o777;
  assert.equal(stored.parameters.ghcrToken.value, "package-read-token");
  assert.equal(mode, 0o600);
  await assert.rejects(writeFile(file, "{}", { flag: "wx" }), {
    code: "EEXIST",
  });
});

test("deployment policy allows only manual runs on main", () => {
  assert.equal(isTrustedDeployment("push", "refs/heads/main"), false);
  assert.equal(
    isTrustedDeployment("workflow_dispatch", "refs/heads/main"),
    true,
  );
  assert.equal(isTrustedDeployment("pull_request", "refs/heads/main"), false);
  assert.equal(isTrustedDeployment("push", "refs/heads/feature"), false);
  assert.equal(
    isTrustedDeployment("workflow_dispatch", "refs/tags/v1.0.0"),
    false,
  );
});

test("regional defaults use Central India with the Static Web Apps exception", () => {
  const env = validEnvironment();
  delete env.LOCATION;
  const { parameters } = buildParameters(env);
  assert.equal(parameters.location.value, "centralindia");
  assert.equal(parameters.staticWebAppLocation.value, "westeurope");
  assert.equal("fileShareQuotaGiB" in parameters, false);
  assert.equal("storageAccountKey" in parameters, false);
  assert.equal("registryName" in parameters, false);
  assert.equal(
    buildParameters({ ...env, STATIC_WEB_APP_LOCATION: "eastasia" }).parameters
      .staticWebAppLocation.value,
    "eastasia",
  );
  assert.throws(
    () => buildParameters({ ...env, LOCATION: "westeurope" }),
    /LOCATION must be centralindia/,
  );
  assert.throws(
    () => buildParameters({ ...env, STATIC_WEB_APP_LOCATION: "centralindia" }),
    /supported Static Web Apps region/,
  );
});

test("preflight rejects non-GHCR images and invalid storage settings", () => {
  const env = validEnvironment();
  assert.throws(
    () =>
      buildParameters({
        ...env,
        API_IMAGE: `example.azurecr.io/api@sha256:${"a".repeat(64)}`,
      }),
    /ghcr.io/,
  );
  assert.throws(
    () => buildParameters({ ...env, STORAGE_ACCOUNT_NAME: "invalid-account" }),
    /STORAGE_ACCOUNT_NAME/,
  );
  for (const quota of ["0", "5121", "1.5", "invalid"]) {
    assert.throws(
      () => buildParameters({ ...env, FILE_SHARE_QUOTA_GIB: quota }),
      /FILE_SHARE_QUOTA_GIB/,
    );
  }
  assert.equal(
    buildParameters({ ...env, FILE_SHARE_QUOTA_GIB: "20" }).parameters
      .fileShareQuotaGiB.value,
    20,
  );
});
