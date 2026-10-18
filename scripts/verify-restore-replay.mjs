#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateScaleFixture } from "./measure-journeys.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultHostDll = path.join(
  root,
  "backend/tests/CostTracking.TestHost/bin/Debug/net10.0/CostTracking.TestHost.dll",
);

export function summarizeFinancialReport(report) {
  if (
    !report ||
    typeof report !== "object" ||
    !Array.isArray(report.items) ||
    typeof report.currency !== "string" ||
    typeof report.month !== "string" ||
    !Number.isInteger(report.streamVersion) ||
    report.streamVersion < 0
  ) {
    throw new Error("Invalid monthly financial report response.");
  }
  const totals = { incomeMinor: 0, expenseMinor: 0, netMinor: 0 };
  for (const item of report.items) {
    for (const field of Object.keys(totals)) {
      if (!Number.isSafeInteger(item?.[field]))
        throw new Error(`Invalid financial report ${field} value.`);
      totals[field] += item[field];
    }
  }
  return {
    currency: report.currency,
    month: report.month,
    streamVersion: report.streamVersion,
    horseRows: report.items.length,
    ...totals,
  };
}

export function summarizePendingApprovals(items) {
  if (!Array.isArray(items))
    throw new Error("Pending approval items must be an array.");
  const keys = items
    .map((item) => {
      if (
        typeof item?.ruleId !== "string" ||
        !item.ruleId ||
        typeof item?.scheduledDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.scheduledDate)
      ) {
        throw new Error("Pending approval item has an invalid key.");
      }
      return JSON.stringify([item.ruleId, item.scheduledDate]);
    })
    .sort();
  if (new Set(keys).size !== keys.length)
    throw new Error("Pending approval keys must be unique.");
  return {
    count: keys.length,
    keyDigestSha256: createHash("sha256")
      .update(JSON.stringify(keys))
      .digest("hex"),
  };
}

export function assertRestoredFinancialReport(report, fixture) {
  const summary = summarizeFinancialReport(report);
  if (
    summary.streamVersion !== fixture.streamEvents ||
    summary.horseRows !== fixture.horses
  ) {
    throw new Error(
      "Restored financial projection does not match the expected fixture stream.",
    );
  }
  return summary;
}

export function assertNoRepairedLedgerStream(bytes) {
  // The JSONL store may initialize an empty file while servicing a read. That
  // is not a restore; any event bytes would mean this negative case was seeded.
  if (bytes !== null && bytes.length !== 0) {
    throw new Error(
      "Read-only missing-restore check found event data in the ledger stream.",
    );
  }
  return { streamFileInitializedByRead: bytes !== null, eventBytes: 0 };
}

export function assertProjectionParity(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      "Restored projection mismatch: financial report or pending approval keys changed.",
    );
  }
}

export function assessBackupAge(createdAtUtc, restoredAtUtc) {
  const created = Date.parse(createdAtUtc);
  const restored = Date.parse(restoredAtUtc);
  if (!Number.isFinite(created) || !Number.isFinite(restored))
    throw new Error("Backup age timestamps must be valid ISO dates.");
  if (restored < created)
    throw new Error(
      "Backup timestamp cannot be after restore verification time.",
    );
  const snapshotAgeSeconds = Math.floor((restored - created) / 1000);
  return {
    targetSeconds: 24 * 60 * 60,
    snapshotAgeSeconds,
    snapshotWithin24HourBoundAtRestore: snapshotAgeSeconds <= 24 * 60 * 60,
    scheduledRpoProven: false,
  };
}

function optionsFromArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || index + 1 >= argv.length)
      throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[++index];
  }
  return args;
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Isolated TestHost exited before becoming ready.");
    try {
      const response = await fetch(`${origin}/__fixture/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).ready === true) return;
    } catch {
      /* retry until timeout */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Isolated TestHost did not become ready within 30 seconds.");
}

async function startHost(dll, storageRoot) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const fixtureOrigin = `http://127.0.0.1:${await availablePort()}`;
  const child = spawn("dotnet", [dll, "--urls", origin], {
    cwd: root,
    env: {
      ...process.env,
      E2E_STORAGE_ROOT: storageRoot,
      E2E_WEB_URL: fixtureOrigin,
    },
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  child.once("error", () => {});
  try {
    await waitForHealth(origin, child);
    return { child, origin, fixtureOrigin };
  } catch (error) {
    await stopHost(child);
    throw error;
  }
}

async function stopHost(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  if (child.exitCode === null && child.signalCode === null)
    throw new Error(`TestHost process ${child.pid} did not stop.`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    ...options,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `Local replay verification request failed with HTTP ${response.status}.`,
    );
  return { body, response };
}

async function authenticateFixture(host) {
  const mutationHeaders = {
    Origin: host.fixtureOrigin,
    "Content-Type": "application/json",
  };
  const { body: session, response: sessionResponse } = await fetchJson(
    `${host.origin}/__fixture/session`,
    {
      method: "POST",
      headers: mutationHeaders,
      body: "{}",
    },
  );
  if (session?.subject !== "user_Fixture")
    throw new Error("Fixture session returned an unexpected subject.");
  const setCookie =
    sessionResponse.headers.getSetCookie?.()[0] ??
    sessionResponse.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (!cookie) throw new Error("Fixture session did not issue a cookie.");
  const { body: auth } = await fetchJson(`${host.origin}/auth/session`, {
    headers: { Cookie: cookie, Origin: "https://app.test" },
  });
  if (!auth?.accessToken)
    throw new Error("Authenticated fixture session returned no access token.");
  return {
    subject: session.subject,
    authorization: {
      Authorization: `Bearer ${auth.accessToken}`,
      Origin: "https://app.test",
    },
    mutationHeaders,
  };
}

async function readProjectionSnapshot(host, authorization, fixture) {
  const { body: report } = await fetchJson(
    `${host.origin}/api/v1/reports/monthly-pnl?month=2026-09`,
    {
      headers: authorization,
    },
  );
  const reportSummary = assertRestoredFinancialReport(report, fixture);

  const pendingItems = [];
  let cursor = null;
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const url = new URL("/api/v1/income-approvals", host.origin);
    url.searchParams.set("from", "2026-09-01");
    url.searchParams.set("through", "2026-09-30");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const { body } = await fetchJson(url, { headers: authorization });
    if (
      body.streamVersion !== fixture.streamEvents ||
      !Array.isArray(body.items)
    ) {
      throw new Error(
        "Pending income projection did not replay the complete fixture stream.",
      );
    }
    pendingItems.push(...body.items);
    cursor = body.nextCursor;
    if (!cursor) break;
    if (pageIndex === 99)
      throw new Error(
        "Pending income projection exceeded the pagination safety limit.",
      );
  }
  return {
    fixture: {
      horses: fixture.horses,
      setupEvents: fixture.setupEvents,
      acceptedChanges: fixture.acceptedChanges,
      streamEvents: fixture.streamEvents,
      eventMix: fixture.eventMix,
      dateWindow: fixture.dateWindow,
    },
    report: reportSummary,
    pending: summarizePendingApprovals(pendingItems),
  };
}

async function snapshotSeededHost(host) {
  const session = await authenticateFixture(host);
  const { body: scale } = await fetchJson(`${host.origin}/__fixture/scale`, {
    method: "POST",
    headers: session.mutationHeaders,
    body: "{}",
  });
  const fixture = validateScaleFixture({ ...scale, subject: session.subject });
  return {
    fixture,
    ...(await readProjectionSnapshot(host, session.authorization, fixture)),
  };
}

async function snapshotRestoredHost(host, fixture) {
  const session = await authenticateFixture(host);
  // Intentionally do not call the mutating scale hook: replay verification must
  // fail if restore omitted the ledger, rather than repair it by reseeding.
  return {
    fixture,
    ...(await readProjectionSnapshot(host, session.authorization, fixture)),
  };
}

async function runBackup(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: "ignore" });
  const [code, signal] = await new Promise((resolve) =>
    child.once("close", (status, closeSignal) =>
      resolve([status, closeSignal]),
    ),
  );
  if (code !== 0)
    throw new Error(
      `Local archive ${path.basename(args[0])} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`,
    );
}

async function verifySourceMatchesManifest(sourceRoot, manifest) {
  for (const record of manifest.streams) {
    const bytes = await readFile(path.join(sourceRoot, record.path));
    const hash = createHash("sha256").update(bytes).digest("hex");
    const count =
      bytes.length === 0
        ? 0
        : bytes.toString("utf8").trimEnd().split("\n").length;
    if (hash !== record.sha256 || count !== record.eventCount) {
      throw new Error(
        "Original source ledger changed during local restore verification.",
      );
    }
  }
}

async function assertEmptyRestoreIsNotRepaired(host, storageRoot, fixture) {
  const session = await authenticateFixture(host);
  let rejected = false;
  try {
    await readProjectionSnapshot(host, session.authorization, fixture);
  } catch {
    rejected = true;
  }
  if (!rejected)
    throw new Error(
      "An empty restore unexpectedly returned a complete fixture projection.",
    );
  const subjectHash = createHash("sha256").update("user_Fixture").digest("hex");
  const expectedStream = path.join(
    storageRoot,
    "users",
    subjectHash,
    `events_${subjectHash}.jsonl`,
  );
  const sourceBytes = await readFile(expectedStream).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return {
    reportReadRejected: true,
    ...assertNoRepairedLedgerStream(sourceBytes),
  };
}

export async function runRestoreReplayVerification({
  hostDll = defaultHostDll,
} = {}) {
  const dll = path.resolve(hostDll);
  if (!(await stat(dll).catch(() => null))?.isFile())
    throw new Error(
      "TestHost DLL does not exist; build the isolated TestHost before running this check.",
    );
  const archiveRoot = path.join(os.tmpdir(), "cost-tracking-e2e");
  await mkdir(archiveRoot, { recursive: true });
  const workspace = await mkdtemp(path.join(archiveRoot, "ops-restore-"));
  const sourceRoot = path.join(workspace, "source-root");
  const backupRoot = path.join(workspace, "backup-archive");
  const restoredRoot = path.join(workspace, "restored-root");
  const emptyRestoreRoot = path.join(workspace, "empty-restore-root");
  await mkdir(sourceRoot);
  await mkdir(emptyRestoreRoot);
  let host;
  try {
    host = await startHost(dll, sourceRoot);
    const before = await snapshotSeededHost(host);
    await stopHost(host.child);
    host = null;

    const python = process.env.PYTHON ?? "python3";
    const helper = path.join(root, "scripts/ledger-archive.py");
    await runBackup(python, [
      helper,
      "backup",
      sourceRoot,
      backupRoot,
      "--writers-stopped",
    ]);
    await runBackup(python, [helper, "verify", backupRoot]);
    const manifest = JSON.parse(
      await readFile(path.join(backupRoot, "manifest.json"), "utf8"),
    );
    await runBackup(python, [
      helper,
      "restore",
      backupRoot,
      restoredRoot,
      "--writers-stopped",
    ]);
    await verifySourceMatchesManifest(sourceRoot, manifest);

    host = await startHost(dll, restoredRoot);
    const after = await snapshotRestoredHost(host, before.fixture);
    assertProjectionParity(before, after);
    await stopHost(host.child);
    host = null;

    host = await startHost(dll, emptyRestoreRoot);
    const negativeControl = await assertEmptyRestoreIsNotRepaired(
      host,
      emptyRestoreRoot,
      before.fixture,
    );
    await stopHost(host.child);
    host = null;

    const verifiedAt = new Date().toISOString();
    return {
      recordedAtUtc: verifiedAt,
      mode: "local-synthetic-testhost-archive-restore",
      gateEligible: false,
      azureRestoreVerified: false,
      fixture: before.fixture,
      before: { report: before.report, pending: before.pending },
      after: { report: after.report, pending: after.pending },
      projectionParity: true,
      originalSourceUnchanged: true,
      emptyRootRejectedWithoutRepair: true,
      negativeControl,
      backup: {
        formatVersion: manifest.formatVersion,
        createdAtUtc: manifest.createdAtUtc,
        streamCount: manifest.streams.length,
        eventCount: manifest.streams.reduce(
          (sum, item) => sum + item.eventCount,
          0,
        ),
        sha256: manifest.streams.map((item) => item.sha256),
        age: assessBackupAge(manifest.createdAtUtc, verifiedAt),
      },
    };
  } finally {
    if (host) await stopHost(host.child);
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const args = optionsFromArgs(process.argv.slice(2));
  const report = await runRestoreReplayVerification({
    hostDll: args["testhost-dll"],
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output)
    await writeFile(args.output, json, { flag: "wx", mode: 0o600 });
  else process.stdout.write(json);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
