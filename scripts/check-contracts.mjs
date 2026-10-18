import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const update = process.argv.includes('--write');
const temporary = await mkdtemp(path.join(tmpdir(), 'cost-contracts-'));
async function run(command, args) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}
try {
  await run('dotnet', ['build', 'backend/CostTracking.slnx', '--no-restore', '--disable-build-servers', '-m:1', '-p:UseSharedCompilation=false']);
  await run('dotnet', ['test', 'backend/tests/CostTracking.Tests', '--no-build', '--no-restore', '--filter', 'FullyQualifiedName~Contracts']);
  const api = path.join(temporary, 'openapi.json');
  const types = path.join(temporary, 'schema.d.ts');
  await run('dotnet', ['run', '--project', 'backend/tests/CostTracking.TestHost', '--no-build', '--', '--export-openapi', api]);
  const document = JSON.parse(await readFile(api, 'utf8'));
  // TestServer's local URL is not part of the transport contract.
  delete document.servers;
  await writeFile(api, JSON.stringify(document, null, 2) + '\n');
  await run(process.execPath, ['frontend/node_modules/openapi-typescript/bin/cli.js', api, '--output', types]);
  for (const [generated, destination] of [[api, 'backend/openapi.json'], [types, 'frontend/src/api/schema.d.ts']]) {
    const expected = await readFile(generated, 'utf8');
    const target = path.join(root, destination);
    if (update) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, expected);
      continue;
    }
    let actual;
    try { actual = await readFile(target, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual !== expected) throw new Error(`Contract drift: ${destination}. Review changes, then run node scripts/check-contracts.mjs --write.`);
  }
  console.log(update ? 'Contracts generated; review the diff.' : 'Contract generation and event schema checks passed without drift.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
