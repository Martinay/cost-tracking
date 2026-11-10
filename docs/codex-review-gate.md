# Codex review merge gate

`Codex review gate` is a commit status on the PR's **current head SHA**. It reuses
the existing Codex GitHub integration's summary; it does not run an AI review,
need an OpenAI API key, post comments, request reviews, resolve findings, or change
code in response to findings. The workflow job is named `Reconcile Codex summary
metadata`, so its own successful check cannot satisfy this status requirement.

## Policy and metadata contract

The raw [PR #6 summary](https://github.com/Martinay/cost-tracking/pull/6#issuecomment-6779219220)
was read from GitHub's API on 2026-11-10. Its actual `user` was
`chatgpt-codex-connector[bot]`, numeric ID `199175422`, type `Bot`. All three must
match on API-returned comments; event senders, mentions, reactions and visible
labels are not evidence. That comment's head was
`cf162a102c754f1c68704d0b85edef1bce8b79c2`, with `status: "completed"`,
`has_any_findings: true` and `has_unresolved_findings: true`: **failure**.

The hidden Markdown format is undocumented. We accept exactly one summary marker
and one `codex-review-state:v1` marker on the first two lines, followed by a JSON
object with `code_review` and optional, ignored `security_review`. Duplicate JSON
keys (including escaped aliases), extra root/code-review fields, missing fields,
unknown versions, invalid types and contradictory findings fail closed. Multiple
summary comments are ordered by creation time, then numeric ID; only the newest
authenticated candidate is evaluated, even if malformed. An edit to an older
comment cannot supersede a newer summary. Multiple markers in one comment are
ambiguous and fail. No inline review-thread or security-review API is consulted.

| Current API state | Commit status |
| --- | --- |
| No authenticated summary (including after deletion) | Pending |
| Valid summary for an older commit | Pending |
| Valid unstarted/running code review | Pending |
| Current completed review with unresolved findings | Failure |
| Current completed review with no unresolved findings | Success |
| Malformed, unsupported, contradictory, failed or error state | Failure |
| API/reconciliation error | Failure attempted; workflow fails |

`code_review` must contain exactly `commit_sha`, `has_any_findings`,
`has_unresolved_findings`, and `status`. Completion requires a lowercase 40-digit
hex commit SHA and two booleans. Success requires `status === "completed"`, a SHA
equal to the current PR head, and `has_unresolved_findings === false`.
**Resolved findings may pass even while `has_any_findings` remains true.** This
policy allows findings to be resolved without requiring a completely clean rerun.
The gate trusts the integration to reflect resolutions in its metadata.

Recognized waiting statuses are `null`, `pending`, `queued`, `running`, and
`in_progress`; their SHA and findings may be null, but fields must be present and
otherwise correctly typed. Unknown statuses block with failure. A visible
“✅ Completed” label never overrides the metadata. If the integration changes its
format, investigate and update the parser and fixtures; do not relax it to infer
success from missing fields or absent findings.

## Execution, permissions and races

The separate workflow uses `pull_request_target` for opened, reopened,
synchronize and ready-for-review events; `issue_comment` for created, edited and
deleted comments on PRs; and `workflow_dispatch` for a specified PR. All PR comment
events reconcile, including edits that remove the marker and deletions. Regular
issue comments are skipped. Event data supplies only the PR number. Manual runs
must use the default branch and a canonical positive PR number (for example `7`,
not `07`). Closed PRs are ignored.

It uses only `contents: read`, `pull-requests: read` (also permits reading PR issue
comments), and `statuses: write`; all other token permissions are disabled. It
fetches executable reconciler code through the contents API from the repository's
current default branch, never the PR head or an input ref. There is no checkout,
artifact download, PR code execution, or interpolation of comments into commands.
Comment bodies are parsed as data only. Keep this workflow and script under
trusted maintainer review, as with other status-writing automation.

The concurrency key is shared across event types and manual runs for each PR,
with `cancel-in-progress: false`. GitHub can replace queued runs and does not
guarantee event order; every run reads current API state, so delayed events do not
restore event-payload results. The reconciler first posts pending to revoke a
previous success, paginates comments in batches of 100, checks the PR head again
after pagination, and requires two matching snapshots before publishing. A
post-publication snapshot repairs changes across the last read/write window.
Repeated changes exhaust a bounded retry loop, attempt failure, and fail the job.

GitHub has no atomic transaction between comment reads and status writes. There
is a short propagation/read-write window; later events repair it. If GitHub cannot
serve the initial head/code fetch or accept any status writes, the workflow fails
but cannot revoke an already published success. Monitor failed workflow runs and
manually reconcile after recovery. A new SHA has no inherited success. Do not
treat this automation as an atomic lock against all GitHub outages. Commit
statuses are SHA-scoped, so PRs sharing a head SHA share that status context.

Fork PRs deliberately use the base repository's trusted `pull_request_target`
execution and token. Status writes target the base repository API with the fork
PR's head SHA; no fork write token or PAT is needed. Actions policies, disabled
workflows, integration availability, or inaccessible fork commits can still
prevent reconciliation: these must remain blocked and be investigated. Confirm
actual fork behavior during activation rather than granting write access to a
`pull_request` job or enabling PR code execution. GitHub may suppress some
`pull_request_target` runs (for example branch names resembling SHAs); use a
manual default-branch reconciliation if needed. Fork Codex reviews still depend
on the integration's own access and review configuration.

## One-time activation (maintainer)

1. Review and land the workflow, reconciler, tests and this guide on `main` first.
   `issue_comment` and dispatch require the workflow on the default branch, and
   the reconciler is always loaded from there. This implementation PR alone
   cannot establish the gate's live behavior. Do not merge it automatically.
2. Open a test PR and use Actions → **Reconcile Codex review status** → Run
   workflow, select `main`, enter its PR number. Check both the automatic event
   run and a manual run. Inspect statuses on the actual head:

   ```sh
   gh api repos/Martinay/cost-tracking/pulls/NUMBER --jq .head.sha
   gh api --paginate repos/Martinay/cost-tracking/commits/HEAD_SHA/statuses \
     --jq '.[] | select(.context == "Codex review gate") | {state,sha,description,target_url,creator:.creator.login}'
   ```

   The newest matching status must reference `HEAD_SHA`, link to the summary (or
   workflow run while missing/error), and reflect the metadata. Wait for the
   existing integration's normal review activity; this gate never triggers it.
3. In Settings → Rules → Rulesets, edit the **existing active ruleset targeting
   `main`**. Under required status checks, **add** `Codex review gate` with the
   GitHub Actions source observed in step 2 where source selection is offered.
   Keep every existing check, review requirement, bypass restriction and other
   protection. Do not replace the ruleset or select the reconciler job's name.
   The status may need a recent live run before it appears in the selector.
4. Verify without an administrator/bypass merge: a PR with pending/missing review
   must show merging blocked by `Codex review gate`; a completed review with
   unresolved findings must also block. A valid completed review with no
   unresolved findings should satisfy only this requirement; other protections
   still apply. Push a new commit after success and verify the new head remains
   blocked until its own completed review. Observe same-comment updates, a
   deletion, and rapid updates converging to current metadata. Check a fork PR
   if forks are part of the contribution flow. Do not merge a failing test PR.

Ruleset enforcement, source binding, real token/fork permissions, integration
events and the merge UI need live validation after landing; they are not proven
by local unit tests. No existing repository protection is modified by this change.

## Merge queues

This gate does **not** support merge queues. It does not listen to `merge_group`
and cannot attest to a synthetic queue SHA using a review of a different PR head.
Requiring this context on a merge group will leave the queue blocked. Do not copy
PR-head success to a queue commit or fabricate success on `merge_group`. Queue
support needs a separately designed policy and integration evidence for the exact
synthetic SHA before enabling a queue with this requirement.

## Local verification

Use the pinned Node 24.19.0 from `README.md`:

```sh
node --test scripts/codex-review-gate.test.mjs
actionlint .github/workflows/codex-review-gate.yml .github/workflows/ci.yml
git diff --check
```

The credential-free tests mock GitHub head reads, paginated comments and status
writes. They cover completion, unresolved/resolved findings, stale/missing/running
reviews, spoofed authors, malformed/duplicate/versioned metadata, deletion, API
and status-write errors, changing heads, edits across publication, delayed events,
modeled overlap under the workflow lock, and the actual inline default-branch
loader. CI runs these alongside the existing validation suite. They do not run an
AI review, exercise the live scheduler, or establish application release readiness.

References: [GitHub workflow event trust and fork behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target),
[concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[PR issue-comment permissions](https://docs.github.com/en/rest/issues/comments#list-issue-comments),
and [commit status semantics](https://docs.github.com/en/rest/commits/statuses).
