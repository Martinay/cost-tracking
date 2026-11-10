import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { evaluate, reconcile } = require('./codex-review-gate.cjs');
const sha = 'cf162a102c754f1c68704d0b85edef1bce8b79c2';
const other = 'a'.repeat(40);
const review = (changes = {}) => ({ commit_sha: sha, has_any_findings: false,
  has_unresolved_findings: false, status: 'completed', ...changes });
const body = (value = review()) => '<!-- codex-pull-request-review-summary -->\n' +
  `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: value, security_review: null })} -->`;
const comment = (changes = {}) => ({ id: 6779219220,
  user: { login: 'chatgpt-codex-connector[bot]', id: 199175422, type: 'Bot' },
  created_at: '2026-11-10T21:04:17Z', updated_at: '2026-11-10T21:05:40Z',
  body: body(), ...changes });
const state = (comments) => evaluate(sha, comments).state;

test('clean and resolved completion pass; security review is irrelevant', () => {
  assert.equal(state([comment()]), 'success');
  assert.equal(state([comment({ body: body().replace(',"security_review":null', '') })]), 'success');
  assert.equal(state([comment({ body: body(review({ has_any_findings: true })) })]), 'success');
  assert.equal(state([comment({ body: body().replace('"security_review":null', '"security_review":{"status":"failed"}') })]), 'success');
});

test('PR #6 observed completed metadata fails for unresolved findings', () => {
  const observed = '<!-- codex-pull-request-review-summary -->\n' +
    '<!-- codex-review-state:v1 {"code_review":{"commit_sha":"cf162a102c754f1c68704d0b85edef1bce8b79c2","has_any_findings":true,"has_unresolved_findings":true,"status":"completed"},"security_review":{"commit_sha":null,"has_any_findings":null,"has_unresolved_findings":null,"status":null}} -->';
  assert.equal(state([comment({ body: observed })]), 'failure');
});

test('missing, deleted, stale and running summaries stay pending', () => {
  assert.equal(state([]), 'pending');
  assert.equal(state([comment({ body: body(review({ commit_sha: other })) })]), 'pending');
  for (const status of ['running', 'in_progress', 'pending', 'queued', null]) {
    assert.equal(state([comment({ body: body(review({ status, has_any_findings: null, has_unresolved_findings: null })) })]), 'pending');
  }
});

test('both numeric identity and login and Bot type are required', () => {
  for (const changes of [{ id: 1 }, { login: 'someone-else' }, { type: 'User' }, { id: '199175422' }]) {
    assert.equal(state([comment({ user: { ...comment().user, ...changes } })]), 'pending');
  }
});

test('malformed, unsupported, ambiguous or failed metadata never passes', () => {
  const invalid = [
    '', '<!-- codex-pull-request-review-summary -->',
    body().replace(':v1 ', ':v2 '), body() + '\n' + body(),
    body().replace('"status":"completed"', '"status":"completed","status":"completed"'),
    body().replace('"status":', '"sta\\u0074us":"completed","status":'),
    body().replace('"code_review":', '"code_review":{},"code_review":'),
    body().replace('"has_any_findings":false,', ''),
    body().replace('"has_unresolved_findings":false', '"has_unresolved_findings":"false"'),
    body().replace('"completed"', '"failed"'),
    body(review({ extra: true })), body(review({ commit_sha: null })),
    body(review({ has_any_findings: false, has_unresolved_findings: true })),
    body(review({ has_any_findings: null })), body(null), body({}),
    body().replace('{"code_review"', '{bad,"code_review"'),
  ];
  for (const raw of invalid) assert.notEqual(state([comment({ body: raw })]), 'success', raw);
});

test('newest authenticated summary wins across pages, regardless of edit order', () => {
  const newer = comment({ id: 6779219221, created_at: '2026-11-10T21:06:17Z', body: body(review({ status: 'failed' })) });
  assert.equal(state([newer, comment({ updated_at: '2026-11-10T22:00:00Z' })]), 'failure');
  assert.equal(state([comment(), comment({ ...newer, user: { id: 1 } })]), 'success');
});

function mock({ heads = [sha], pages = [[comment()]], failRead = false, onPublish } = {}) {
  const writes = [];
  let reads = 0;
  const github = { rest: {
    pulls: { get: async () => ({ data: { state: 'open', head: { sha: heads[Math.min(reads++, heads.length - 1)] } } }) },
    issues: { listComments: async ({ page, per_page }) => {
      assert.equal(per_page, 100);
      if (failRead) throw new Error('API unavailable');
      return { data: structuredClone(pages[page - 1] || []) };
    } },
    repos: { createCommitStatus: async (args) => { writes.push(args); await onPublish?.(args, pages); } },
  } };
  return { github, writes, run: () => reconcile({ github, owner: 'Martinay', repo: 'cost-tracking',
    pullNumber: 7, runUrl: 'https://github.com/Martinay/cost-tracking/actions/runs/1' }) };
}

test('publishes explicit head SHA and summary link; handles pagination', async () => {
  const m = mock({ pages: [Array.from({ length: 100 }, (_, id) => comment({ id, user: { id: 1 } })), [comment()]] });
  await m.run();
  assert.equal(m.writes.at(-1).state, 'success');
  assert.ok(m.writes.every(w => w.sha === sha && w.context === 'Codex review gate'));
  assert.match(m.writes.at(-1).target_url, /issuecomment-6779219220$/);
});

test('API errors revoke prior success and fail the reconciliation', async () => {
  const m = mock({ failRead: true });
  await assert.rejects(m.run(), /API unavailable/);
  assert.equal(m.writes.at(-1).state, 'failure');
  assert.ok(!m.writes.some(w => w.state === 'success'));
});

test('head changes during reconciliation cannot reuse earlier successful review', async () => {
  const m = mock({ heads: [sha, sha, other, other] });
  await m.run();
  assert.equal(m.writes.at(-1).sha, other);
  assert.equal(m.writes.at(-1).state, 'pending');
  assert.ok(!m.writes.some(w => w.sha === other && w.state === 'success'));
});

test('deletion during a run is re-read; old event payloads cannot restore success', async () => {
  const m = mock({ onPublish: (args, pages) => { if (args.state === 'pending') pages[0] = []; } });
  await m.run();
  await m.run(); // Delayed older event, still reads current API state.
  assert.equal(m.writes.at(-1).state, 'pending');
  assert.ok(!m.writes.some(w => w.state === 'success'));
});

test('edit immediately after publishing is repaired by post-publication read', async () => {
  const m = mock({ onPublish: (args, pages) => {
    if (args.state === 'success') pages[0][0].body = body(review({ has_any_findings: true, has_unresolved_findings: true }));
  } });
  await m.run();
  assert.equal(m.writes.at(-1).state, 'failure');
});

test('status write failures fail the job instead of claiming success', async () => {
  const m = mock();
  m.github.rest.repos.createCommitStatus = async () => { throw new Error('Forbidden'); };
  await assert.rejects(m.run(), /Forbidden/);
});

test('initial API failures and invalid PR responses cannot produce success', async () => {
  for (const response of [null, { head: { sha } }, { state: 'open', head: { sha: 'invalid' } }]) {
    const m = mock();
    m.github.rest.pulls.get = async () => ({ data: response });
    await assert.rejects(m.run(), /Invalid PR state/);
    assert.equal(m.writes.length, 0);
  }
  const m = mock();
  m.github.rest.pulls.get = async () => { throw new Error('API unavailable'); };
  await assert.rejects(m.run(), /API unavailable/);
  assert.equal(m.writes.length, 0);
});

test('newer malformed summary blocks instead of falling back to old success', () => {
  assert.equal(state([comment(), comment({ id: 6779219221,
    created_at: '2026-11-10T21:06:17Z', body: '<!-- codex-pull-request-review-summary -->' })]), 'failure');
});

test('repeated changes exhaust retries and block the current head', async () => {
  const m = mock();
  let version = 0;
  m.github.rest.issues.listComments = async () => ({ data: [comment({ updated_at: String(version++) })] });
  await assert.rejects(m.run(), /changed repeatedly/);
  assert.equal(m.writes.at(-1).state, 'failure');
  assert.ok(!m.writes.some(w => w.state === 'success'));
});

test('closed PRs are ignored and invalid manual PR numbers are rejected', async () => {
  const m = mock();
  m.github.rest.pulls.get = async () => ({ data: { state: 'closed', head: { sha } } });
  await m.run();
  assert.equal(m.writes.length, 0);
  for (const pullNumber of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1, '7']) {
    await assert.rejects(reconcile({ github: m.github, pullNumber }), /Invalid PR number/);
  }
});

const workflow = await readFile(new URL('../.github/workflows/codex-review-gate.yml', import.meta.url), 'utf8');

test('workflow covers edits/deletions, shares a per-PR lock, and uses minimal permissions', () => {
  assert.match(workflow, /types: \[opened, reopened, synchronize, ready_for_review\]/);
  assert.match(workflow, /types: \[created, edited, deleted\]/);
  assert.match(workflow, /group: codex-review-reconcile-\$\{\{ github.event.pull_request.number \|\| github.event.issue.number \|\| inputs.pr_number \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)/);
  assert.match(workflow, /name: Reconcile Codex summary metadata/);
  assert.doesNotMatch(workflow, /name: Codex review gate|actions\/checkout|secrets\.|issues: write|pull-requests: write|contents: write/);
});

test('overlapping events under the workflow lock converge even in reversed event order', async () => {
  let entered;
  let release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  let first = true;
  const m = mock({ onPublish: async () => {
    if (first) { first = false; entered(); await barrier; }
  } });
  const activeRun = m.run();
  await waiting;
  // New edit arrives while the first reconciliation holds the Actions lock.
  // The pending run (possibly an older event delivered late) starts after it.
  m.github.rest.issues.listComments = async () => ({ data: [comment({ body: body(review({
    has_any_findings: true, has_unresolved_findings: true,
  })) })] });
  const queuedRun = activeRun.then(() => m.run());
  release();
  await Promise.all([activeRun, queuedRun]);
  assert.equal(m.writes.at(-1).state, 'failure');
  assert.ok(!m.writes.some(w => w.state === 'success'));
});

test('actual workflow bootstrap fetches only default-branch code and ignores event content', async () => {
  const source = await readFile(new URL('./codex-review-gate.cjs', import.meta.url), 'utf8');
  const inline = workflow.split('          script: |\n')[1].split('\n').map(l => l.slice(12)).join('\n');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const m = mock();
  m.github.rest.repos.get = async () => ({ data: { default_branch: 'main' } });
  m.github.rest.repos.getContent = async (args) => {
    assert.deepEqual(args, { owner: 'Martinay', repo: 'cost-tracking', ref: 'main', path: 'scripts/codex-review-gate.cjs' });
    return { data: { type: 'file', encoding: 'base64', content: Buffer.from(source).toString('base64') } };
  };
  const previous = process.env.PR_NUMBER;
  try {
    process.env.PR_NUMBER = '7';
    await new AsyncFunction('github', 'context', inline)(m.github, {
      repo: { owner: 'Martinay', repo: 'cost-tracking' }, serverUrl: 'https://github.com', runId: 1,
      sha: other, payload: { comment: { body: 'throw new Error("untrusted")' } },
    });
    assert.equal(m.writes.at(-1).sha, sha);
    assert.equal(m.writes.at(-1).state, 'success');
    process.env.PR_NUMBER = '07';
    await assert.rejects(new AsyncFunction('github', 'context', inline)(m.github, {}), /positive integer/);
  } finally {
    if (previous === undefined) delete process.env.PR_NUMBER;
    else process.env.PR_NUMBER = previous;
  }
});
