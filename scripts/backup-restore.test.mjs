import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backup = path.join(root, 'scripts/backup-ledger.sh');
const restore = path.join(root, 'scripts/restore-ledger.sh');

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ledger-restore-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const subject = 'user_fixture123';
  const hash = createHash('sha256').update(subject).digest('hex');
  const userDirectory = path.join(source, 'users', hash);
  await mkdir(userDirectory, { recursive: true });
  const stream = path.join(userDirectory, `events_${hash}.jsonl`);
  const events = [1, 2].map(streamVersion => JSON.stringify({
    eventId: `00000000-0000-4000-8000-${String(streamVersion).padStart(12, '0')}`,
    streamVersion,
    subject,
    type: 'AccountConfigured',
  }));
  const bytes = `${events.join('\n')}\n`;
  await writeFile(stream, bytes);
  await mkdir(path.join(source, 'auth', 'sessions'), { recursive: true });
  await writeFile(path.join(source, 'auth', 'sessions', 'secret'), 'must-not-be-backed-up');
  return { directory, source, subject, hash, stream, bytes };
}

function invoke(script, args) {
  return spawnSync('bash', [script, ...args], { cwd: root, encoding: 'utf8' });
}

test('backup records exact ledger prefix metadata and excludes authentication state', async t => {
  const f = await fixture(t);
  const destination = path.join(f.directory, 'independent-backup');
  const result = invoke(backup, [f.source, destination, '--writers-stopped']);
  assert.equal(result.status, 0, result.stderr);

  const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
  assert.equal(manifest.streams.length, 1);
  assert.equal(manifest.streams[0].path, `users/${f.hash}/events_${f.hash}.jsonl`);
  assert.equal(manifest.streams[0].eventCount, 2);
  assert.equal(manifest.streams[0].lastVersion, 2);
  assert.equal(manifest.streams[0].sha256, createHash('sha256').update(f.bytes).digest('hex'));
  assert.equal(await readFile(path.join(destination, manifest.streams[0].path), 'utf8'), f.bytes);
  assert.equal(result.stdout.includes('auth'), false);
});

test('backup refuses a truncated final event and preserves the source bytes', async t => {
  const f = await fixture(t);
  const truncated = `${f.bytes.slice(0, -1)}{"streamVersion":3`;
  await writeFile(f.stream, truncated);
  const destination = path.join(f.directory, 'backup');
  const result = invoke(backup, [f.source, destination, '--writers-stopped']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unterminated|newline|truncated/i);
  assert.equal(await readFile(f.stream, 'utf8'), truncated);
});

test('backup rejects version gaps and a subject stored outside its hashed directory', async t => {
  const f = await fixture(t);
  await writeFile(f.stream, [1, 3].map(streamVersion => JSON.stringify({
    streamVersion, subject: f.subject,
  })).join('\n') + '\n');
  const gap = invoke(backup, [f.source, path.join(f.directory, 'gap-backup'), '--writers-stopped']);
  assert.notEqual(gap.status, 0);
  assert.match(gap.stderr, /version/i);

  await writeFile(f.stream, JSON.stringify({ streamVersion: 1, subject: 'user_someoneelse' }) + '\n');
  const wrongSubject = invoke(backup, [f.source, path.join(f.directory, 'subject-backup'), '--writers-stopped']);
  assert.notEqual(wrongSubject.status, 0);
  assert.match(wrongSubject.stderr, /subject|hash/i);
});

test('restore verifies and copies a backup into a fresh destination byte for byte', async t => {
  const f = await fixture(t);
  const backupDirectory = path.join(f.directory, 'backup');
  const destination = path.join(f.directory, 'restored');
  const backupResult = invoke(backup, [f.source, backupDirectory, '--writers-stopped']);
  assert.equal(backupResult.status, 0, backupResult.stderr);
  const restoreResult = invoke(restore, [backupDirectory, destination, '--writers-stopped']);
  assert.equal(restoreResult.status, 0, restoreResult.stderr);

  const manifest = JSON.parse(await readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
  assert.equal(await readFile(path.join(destination, manifest.streams[0].path), 'utf8'), f.bytes);
  const verification = invoke(restore, ['--verify-only', backupDirectory]);
  assert.equal(verification.status, 0, verification.stderr);
});

test('all 17 canonical event variants retain the identical replay input across backup and restore', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ledger-all-variants-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = await readFile(path.join(root, 'backend/tests/CostTracking.Tests/Fixtures/Events/story-events-v1.jsonl'));
  const events = bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const subject = events[0].subject;
  const hash = createHash('sha256').update(subject).digest('hex');
  const source = path.join(directory, 'source');
  const relativePath = `users/${hash}/events_${hash}.jsonl`;
  const streamPath = path.join(source, relativePath);
  await mkdir(path.dirname(streamPath), { recursive: true });
  await writeFile(streamPath, bytes);

  const backupDirectory = path.join(directory, 'backup');
  const destination = path.join(directory, 'restored');
  assert.equal(invoke(backup, [source, backupDirectory, '--writers-stopped']).status, 0);
  assert.equal(invoke(restore, [backupDirectory, destination, '--writers-stopped']).status, 0);

  const restoredBytes = await readFile(path.join(destination, relativePath));
  const restored = restoredBytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const manifest = JSON.parse(await readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
  assert.deepEqual([...new Set(restored.map(event => event.type))].sort(), [...new Set(events.map(event => event.type))].sort());
  assert.equal(new Set(restored.map(event => event.type)).size, 17);
  assert.equal(manifest.streams[0].eventCount, 17);
  assert.equal(manifest.streams[0].lastVersion, 17);
  assert.equal(createHash('sha256').update(restoredBytes).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(restored, events);
});

test('restore refuses an existing destination and a backup whose stream checksum changed', async t => {
  const f = await fixture(t);
  const backupDirectory = path.join(f.directory, 'backup');
  assert.equal(invoke(backup, [f.source, backupDirectory, '--writers-stopped']).status, 0);
  const destination = path.join(f.directory, 'restored');
  await mkdir(destination);
  await writeFile(path.join(destination, 'keep.txt'), 'keep');
  const existingDestination = invoke(restore, [backupDirectory, destination, '--writers-stopped']);
  assert.notEqual(existingDestination.status, 0);
  assert.match(existingDestination.stderr, /empty|fresh|exist/i);
  assert.equal(await readFile(path.join(destination, 'keep.txt'), 'utf8'), 'keep');

  const manifest = JSON.parse(await readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
  const archivedStream = path.join(backupDirectory, manifest.streams[0].path);
  await writeFile(archivedStream, (await readFile(archivedStream, 'utf8')).replace('AccountConfigured', 'HorseRegistered'));
  const corruptBackup = invoke(restore, [backupDirectory, path.join(f.directory, 'other-restore'), '--writers-stopped']);
  assert.notEqual(corruptBackup.status, 0);
  assert.match(corruptBackup.stderr, /checksum|hash|integrity/i);
});

test('backup and restore require explicit writer-stop acknowledgement', async t => {
  const f = await fixture(t);
  const noAckBackup = invoke(backup, [f.source, path.join(f.directory, 'backup')]);
  assert.notEqual(noAckBackup.status, 0);
  assert.match(noAckBackup.stderr, /writers-stopped/i);

  const backupDirectory = path.join(f.directory, 'backup');
  assert.equal(invoke(backup, [f.source, backupDirectory, '--writers-stopped']).status, 0);
  const noAckRestore = invoke(restore, [backupDirectory, path.join(f.directory, 'restored')]);
  assert.notEqual(noAckRestore.status, 0);
  assert.match(noAckRestore.stderr, /writers-stopped/i);
});
