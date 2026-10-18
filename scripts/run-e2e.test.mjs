import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { waitForHttp } from './run-e2e.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testHostDll = path.join(root, 'backend/tests/CostTracking.TestHost/bin/Debug/net10.0/CostTracking.TestHost.dll');

test('does not accept an async health predicate until it resolves true', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('malformed', { status: 200 });
  try {
    await assert.rejects(
      waitForHttp('http://127.0.0.1:1', child, 'fixture', async response => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return response.text().then(body => body === '{"ready":true}');
      }, { timeoutMs: 30, intervalMs: 2 }),
      /did not become ready/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readiness polling removes child exit listeners after each wait', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let maximumListeners = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    maximumListeners = Math.max(maximumListeners, child.listenerCount('exit'));
    throw new Error('not ready');
  };
  try {
    await assert.rejects(
      waitForHttp('http://127.0.0.1:1', child, 'fixture', undefined, { timeoutMs: 35, intervalMs: 2 }),
      /did not become ready/,
    );
    assert.ok(maximumListeners <= 1, `observed ${maximumListeners} exit listeners during polling`);
    assert.equal(child.listenerCount('exit'), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fixture session rejects a spoofed Host even with the allowed browser Origin', { timeout: 20_000 }, async () => {
  const apiPort = await availablePort();
  const webPort = await availablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const child = spawn('dotnet', [testHostDll, '--urls', apiUrl], {
    cwd: root,
    env: { ...process.env, E2E_WEB_URL: webUrl },
    stdio: 'ignore',
  });
  try {
    await waitForHttp(`${apiUrl}/__fixture/health`, child, 'fixture boundary API', async response => {
      if (!response.ok) return false;
      try { return (await response.json()).ready === true; } catch { return false; }
    }, { timeoutMs: 10_000, intervalMs: 50 });

    const response = await postFixtureSession(apiPort, webUrl, 'attacker.invalid');
    assert.equal(response.status, 403);
    assert.equal(response.body, '');

    const loopbackResponse = await postFixtureSession(apiPort, webUrl, `127.0.0.1:${apiPort}`);
    assert.equal(loopbackResponse.status, 200);
    assert.equal(JSON.parse(loopbackResponse.body).subject, 'user_Fixture');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3_000))]);
    }
  }
});

test('fixture restart preserves event ID allocation for later recurring commands', { timeout: 30_000 }, async t => {
  const apiPort = await availablePort();
  const webPort = await availablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const storageParent = path.join(os.tmpdir(), 'cost-tracking-e2e');
  mkdirSync(storageParent, { recursive: true });
  const storageRoot = mkdtempSync(path.join(storageParent, 'restart-id-regression-'));
  const child = spawn('dotnet', [testHostDll, '--urls', apiUrl], {
    cwd: root,
    env: { ...process.env, E2E_WEB_URL: webUrl, E2E_STORAGE_ROOT: storageRoot },
    stdio: 'ignore',
  });
  let passed = false;
  try {
    await waitForHttp(`${apiUrl}/__fixture/health`, child, 'fixture restart API', async response => {
      if (!response.ok) return false;
      try { return (await response.json()).ready === true; } catch { return false; }
    }, { timeoutMs: 10_000, intervalMs: 50 });

    const ownerA = await fixtureToken(apiPort, webUrl, 'user_Fixture');
    const ownerB = await fixtureToken(apiPort, webUrl, 'user_FixtureB');
    const aAccount = await apiJson(apiPort, 'PUT', '/api/v1/account', ownerA, 0,
      { currency: 'EUR', timeZone: 'Europe/Berlin' });
    assert.equal(aAccount.status, 200);
    const aHorse = await apiJson(apiPort, 'POST', '/api/v1/horses', ownerA, 1,
      { name: 'Restart owner A', breed: '', dateOfBirth: null, status: 'Active' });
    assert.equal(aHorse.status, 201);

    const bAccount = await apiJson(apiPort, 'PUT', '/api/v1/account', ownerB, 0,
      { currency: 'EUR', timeZone: 'Europe/Berlin' });
    assert.equal(bAccount.status, 200);
    const bHorse = await apiJson(apiPort, 'POST', '/api/v1/horses', ownerB, 1,
      { name: 'Restart owner B', breed: '', dateOfBirth: null, status: 'Active' });
    assert.equal(bHorse.status, 201);
    const horseId = JSON.parse(bHorse.body).horseId;
    const task = await apiJson(apiPort, 'POST', '/api/v1/tasks', ownerB, 2,
      { horseId, taskDate: '2026-09-20', taskType: 'Riding', minutes: 45, quantity: null, quantityUnit: null, notes: 'Hill work' });
    assert.equal(task.status, 201);
    const secondHorse = await apiJson(apiPort, 'POST', '/api/v1/horses', ownerB, 3,
      { name: 'Second restart horse', breed: '', dateOfBirth: null, status: 'Active' });
    assert.equal(secondHorse.status, 201);
    const secondHorseId = JSON.parse(secondHorse.body).horseId;
    const rate = await apiJson(apiPort, 'PUT', '/api/v1/driving-rate', ownerB, 4, { rateMinorPerKm: 30 });
    assert.equal(rate.status, 200);
    const driving = await apiJson(apiPort, 'POST', '/api/v1/driving', ownerB, 5,
      { expenseDate: '2026-09-20', kilometers: 10.125, description: 'Fixture trip', split: { mode: 'Equal', horseIds: [horseId, secondHorseId] } });
    assert.equal(driving.status, 201);
    const changedRate = await apiJson(apiPort, 'PUT', '/api/v1/driving-rate', ownerB, 6, { rateMinorPerKm: 31 });
    assert.equal(changedRate.status, 200);

    const restart = await postFixtureSession(apiPort, webUrl, `127.0.0.1:${apiPort}`, '{}', '/__fixture/restart');
    assert.equal(restart.status, 200);
    const restartedOwner = await fixtureToken(apiPort, webUrl, 'user_FixtureB');
    const afterRestartHorse = await apiJson(apiPort, 'POST', '/api/v1/horses', restartedOwner, 7,
      { name: 'After restart', breed: '', dateOfBirth: null, status: 'Active' });
    assert.equal(afterRestartHorse.status, 201);
    const newHorseId = JSON.parse(afterRestartHorse.body).horseId;
    const incomeRuleBody = {
      schedule: { cadence: 'Daily', interval: 1, weekdays: [], dayOfMonth: null, startDate: '2026-09-19', endDate: null },
      amountMinor: 10000, source: 'Restart lesson', split: { mode: 'Equal', horseIds: [newHorseId] },
    };
    const incomeRuleKey = crypto.randomUUID();
    const incomeRule = await apiJson(apiPort, 'POST', '/api/v1/income-rules', restartedOwner, 8,
      incomeRuleBody, incomeRuleKey);
    assert.equal(incomeRule.status, 201, `${incomeRule.status} ${incomeRule.body}`);
    const incomeRetry = await apiJson(apiPort, 'POST', '/api/v1/income-rules', restartedOwner, 8,
      incomeRuleBody, incomeRuleKey);
    assert.equal(incomeRetry.status, 201);
    assert.equal(incomeRetry.body, incomeRule.body);
    assert.equal(incomeRetry.etag, incomeRule.etag);
    const expenseRule = await apiJson(apiPort, 'POST', '/api/v1/expense-rules', restartedOwner, 9,
      { schedule: { cadence: 'Daily', interval: 1, weekdays: [], dayOfMonth: null, startDate: '2026-09-19', endDate: null },
        amountMinor: 5000, category: 'Feed', description: 'Restart hay', split: { mode: 'Equal', horseIds: [newHorseId] } });
    assert.equal(expenseRule.status, 201, `${expenseRule.status} ${expenseRule.body}`);
    const expenseRuleId = JSON.parse(expenseRule.body).ruleId;
    const overrideBody = { action: 'Changed', changed: {
      amountMinor: 6000, category: 'Veterinary', description: 'Restart visit',
      split: { mode: 'Equal', horseIds: [newHorseId] },
    } };
    const overrideKey = crypto.randomUUID();
    const override = await apiJson(apiPort, 'PUT', `/api/v1/expense-rules/${expenseRuleId}/occurrences/2026-09-20`, restartedOwner, 10,
      overrideBody, overrideKey);
    assert.equal(override.status, 200, `${override.status} ${override.body}`);
    const overrideRetry = await apiJson(apiPort, 'PUT', `/api/v1/expense-rules/${expenseRuleId}/occurrences/2026-09-20`, restartedOwner, 10,
      overrideBody, overrideKey);
    assert.equal(overrideRetry.status, 200);
    assert.equal(overrideRetry.body, override.body);
    assert.equal(overrideRetry.etag, override.etag);
    passed = true;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3_000))]);
    }
    if (passed) rmSync(storageRoot, { recursive: true, force: true });
    else t.diagnostic(`Preserved TestHost event stream at ${storageRoot}`);
  }
});

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function fixtureToken(port, origin, subject) {
  const session = await postFixtureSession(port, origin, `127.0.0.1:${port}`, JSON.stringify({ subject }));
  assert.equal(session.status, 200, session.body);
  const cookie = session.setCookie?.split(';', 1)[0];
  assert.ok(cookie, 'fixture session must issue its local cookie');
  const lookup = await requestJson(port, 'GET', '/auth/session', { Origin: origin, Cookie: cookie });
  assert.equal(lookup.status, 200, lookup.body);
  return JSON.parse(lookup.body).accessToken;
}

function apiJson(port, method, route, token, version, body, key = crypto.randomUUID()) {
  return requestJson(port, method, route, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
    'If-Match': `"${version}"`,
  }, body);
}

function requestJson(port, method, route, headers, body) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port, path: route, method,
      headers: { Host: `127.0.0.1:${port}`, ...(serialized === undefined ? {} : { 'Content-Length': Buffer.byteLength(serialized) }), ...headers },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8'),
        setCookie: response.headers['set-cookie']?.[0], etag: response.headers.etag }));
    });
    request.on('error', reject);
    request.end(serialized);
  });
}

function postFixtureSession(port, origin, host, body = '{}', route = '/__fixture/session') {
  return new Promise((resolve, reject) => {
    const serialized = body;
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: route,
      method: 'POST',
      headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8'), setCookie: response.headers['set-cookie']?.[0] }));
    });
    request.on('error', reject);
    request.end(serialized);
  });
}
