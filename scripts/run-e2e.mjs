import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const hostProject = path.join(root, 'backend/tests/CostTracking.TestHost');
const env = { ...process.env };
const children = new Set();
let stopping = false;

function launch(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: { ...env, ...options.env },
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', error => {
    child.spawnError = error;
    children.delete(child);
  });
  return child;
}

function childExitError(child, label) {
  if (child.spawnError) return new Error(`${label} failed to start: ${child.spawnError.message}`);
  if (child.exitCode !== null || child.signalCode !== null) {
    return new Error(`${label} exited before readiness (code ${child.exitCode}, signal ${child.signalCode})`);
  }
  return null;
}

function waitOrExit(child, label, milliseconds) {
  return new Promise((resolve, reject) => {
    const error = childExitError(child, label);
    if (error) { reject(error); return; }
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`${label} exited before readiness (code ${code}, signal ${signal})`));
    };
    const onError = spawnError => {
      cleanup();
      reject(new Error(`${label} failed to start: ${spawnError.message}`));
    };
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function waitForHttp(url, child, label, predicate = response => response.ok, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const intervalMs = options.intervalMs ?? 200;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    const childError = childExitError(child, label);
    if (childError) throw childError;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (await predicate(response)) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await waitOrExit(child, label, Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`${label} did not become ready within ${options.timeoutMs ?? 60_000} milliseconds (${lastError})`);
}

async function stopAll() {
  if (stopping) return;
  stopping = true;
  const active = [...children];
  for (const child of active) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await Promise.all(active.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit').catch(() => {});
    await Promise.race([exited, delay(3_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([once(child, 'exit'), delay(3_000)]);
      }
      if (child.exitCode === null && child.signalCode === null) {
        throw new Error(`Process ${child.pid} did not exit after SIGKILL`);
      }
    }
  }));
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => { void stopAll().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15))); });
}

async function main() {
try {
  const apiPort = await availablePort();
  const webPort = await availablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  if (env.E2E_SKIP_BUILD !== '1') {
    const build = launch('dotnet', [
      'build', hostProject, '--disable-build-servers', '-m:1', '-p:UseSharedCompilation=false',
    ]);
    const [buildCode] = await once(build, 'exit');
    if (buildCode !== 0) throw new Error(`Test host build failed with exit code ${buildCode}`);
  }

  const api = launch('dotnet', ['run', '--project', hostProject, '--no-build', '--urls', apiUrl], {
    env: { E2E_WEB_URL: webUrl },
  });
  await waitForHttp(`${apiUrl}/__fixture/health`, api, 'isolated API', async response => {
    if (!response.ok) return false;
    try { return (await response.json()).ready === true; } catch { return false; }
  });

  const vite = launch('npm', ['exec', '--', 'vite', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: frontend,
    env: { VITE_API_BASE_URL: apiUrl },
  });
  await waitForHttp(webUrl, vite, 'Vite frontend');

  const playwright = launch('npm', ['exec', '--', 'playwright', 'test', ...process.argv.slice(2)], {
    cwd: frontend,
    env: { E2E_API_URL: apiUrl, E2E_WEB_URL: webUrl, VITE_API_BASE_URL: apiUrl },
  });
  const [testCode] = await once(playwright, 'exit');
  if (testCode !== 0) throw new Error(`Playwright failed with exit code ${testCode}`);
} finally {
  await stopAll();
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
