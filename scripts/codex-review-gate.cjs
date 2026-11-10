'use strict';

const CONTEXT = 'Codex review gate';
const SHA = /^[a-f0-9]{40}$/;
const result = (state, description, commentId) => ({ state, description, commentId });
const authenticated = (c) => c.user?.id === 199175422 &&
  c.user?.login === 'chatgpt-codex-connector[bot]' && c.user?.type === 'Bot';
const candidates = (comments) => comments.filter(c => authenticated(c) &&
  typeof c.body === 'string' && /codex-pull-request-review-summary|codex-review-state/.test(c.body));

// JSON.parse alone accepts duplicate keys (including escaped aliases). Reject them
// before interpreting undocumented metadata; the input is never executable code.
function strictJson(raw) {
  const value = JSON.parse(raw);
  const stack = [];
  for (const token of raw.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|[^\s{}\[\],:]+/g) || []) {
    const top = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push({});
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top?.keys) top.key = true;
    else if (token.startsWith('"') && top?.key) {
      const key = JSON.parse(token);
      if (top.keys.has(key)) throw new Error('Duplicate JSON key');
      top.keys.add(key);
      top.key = false;
    }
  }
  return value;
}

function evaluate(head, comments) {
  const summaries = candidates(comments).sort((a, b) =>
    Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  if (!summaries.length) return result('pending', 'Waiting for an authenticated Codex code review');
  const latest = summaries[0];
  const invalid = () => result('failure', 'Invalid or unsupported Codex review metadata', latest.id);
  if (summaries.some(c => !Number.isSafeInteger(c.id) || !Number.isFinite(Date.parse(c.created_at)))) return invalid();
  const raw = latest.body;
  if ((raw.match(/codex-pull-request-review-summary/g) || []).length !== 1 ||
      (raw.match(/codex-review-state/g) || []).length !== 1) return invalid();
  const match = raw.match(/^<!-- codex-pull-request-review-summary -->\r?\n<!-- codex-review-state:v1 ([^\r\n]+) -->(?:\r?\n|$)/);
  if (!match) return invalid();
  let metadata;
  try { metadata = strictJson(match[1]); } catch { return invalid(); }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object' ||
      Object.keys(metadata).some(k => !['code_review', 'security_review'].includes(k))) return invalid();
  const code = metadata.code_review;
  const fields = ['commit_sha', 'has_any_findings', 'has_unresolved_findings', 'status'];
  if (!code || Array.isArray(code) || typeof code !== 'object' ||
      Object.keys(code).length !== fields.length || !fields.every(k => Object.hasOwn(code, k))) return invalid();
  if (code.commit_sha !== null && (typeof code.commit_sha !== 'string' || !SHA.test(code.commit_sha))) return invalid();
  if (![code.has_any_findings, code.has_unresolved_findings].every(v => v === null || typeof v === 'boolean')) return invalid();
  if (code.has_any_findings === false && code.has_unresolved_findings === true) return invalid();
  const waiting = [null, 'pending', 'queued', 'running', 'in_progress'];
  if (code.status !== 'completed' && !waiting.includes(code.status)) return invalid();
  if (code.status === 'completed' && (code.commit_sha === null ||
      typeof code.has_any_findings !== 'boolean' || typeof code.has_unresolved_findings !== 'boolean')) return invalid();
  if (code.commit_sha !== head) return result('pending', 'Waiting for Codex review of the current head commit', latest.id);
  if (code.status !== 'completed') return result('pending', 'Codex code review has not completed', latest.id);
  return code.has_unresolved_findings
    ? result('failure', 'Codex code review has unresolved findings', latest.id)
    : result('success', 'Codex code review completed with no unresolved findings', latest.id);
}

async function reconcile({ github, owner, repo, pullNumber, runUrl }) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) throw new Error('Invalid PR number');
  const params = { owner, repo };
  let knownHead;
  const readHead = async () => {
    const { data } = await github.rest.pulls.get({ ...params, pull_number: pullNumber });
    if (typeof data?.head?.sha !== 'string' || !SHA.test(data.head.sha) ||
        !['open', 'closed'].includes(data.state)) throw new Error('Invalid PR state from API');
    knownHead = data.head.sha;
    return data;
  };
  const publish = (sha, value) => github.rest.repos.createCommitStatus({ ...params, sha,
    context: CONTEXT, state: value.state, description: value.description,
    target_url: value.commentId
      ? `https://github.com/${owner}/${repo}/pull/${pullNumber}#issuecomment-${value.commentId}` : runUrl });
  const snapshot = async () => {
    const pr = await readHead();
    const comments = [];
    for (let page = 1; ; page++) {
      const { data } = await github.rest.issues.listComments({ ...params, issue_number: pullNumber, per_page: 100, page });
      if (!Array.isArray(data)) throw new Error('Invalid comments response');
      comments.push(...data);
      if (data.length < 100) break;
    }
    // Re-read head after pagination, which may span a synchronize event.
    const current = await readHead();
    const fingerprint = JSON.stringify([pr.state, pr.head.sha, current.state, current.head.sha,
      candidates(comments).map(c => [c.id, c.created_at, c.updated_at, c.body]).sort((a, b) => a[0] - b[0])]);
    return { pr: current, comments, fingerprint, consistent: pr.head.sha === current.head.sha && pr.state === current.state };
  };
  try {
    const initial = await readHead();
    if (initial.state !== 'open') return;
    // Revoke any previous success while reading; API failures must never pass.
    await publish(initial.head.sha, result('pending', 'Reconciling current Codex review state'));
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await snapshot();
      if (before.pr.state !== 'open') return;
      const current = await snapshot();
      if (current.pr.state !== 'open') return;
      if (!before.consistent || !current.consistent || before.fingerprint !== current.fingerprint) continue;
      const value = evaluate(current.pr.head.sha, current.comments);
      await publish(current.pr.head.sha, value);
      // No atomic compare-and-set exists for statuses. Repair changes observed
      // across the final read/write window; queued events reconcile again too.
      const after = await snapshot();
      if (after.consistent && after.fingerprint === current.fingerprint) return value;
      await publish(after.pr.head.sha, result('pending', 'PR or Codex summary changed; reconciling again'));
    }
    throw new Error('PR or Codex summary changed repeatedly; reconcile again');
  } catch (error) {
    // Best effort: an API outage can prevent even the blocking status write.
    try { await readHead(); } catch { /* retain last API-observed head */ }
    if (knownHead) {
      try { await publish(knownHead, result('failure', 'Codex gate API/reconciliation error; rerun required')); }
      catch { /* preserve original failure and fail the workflow */ }
    }
    throw error;
  }
}

module.exports = { evaluate, reconcile };
