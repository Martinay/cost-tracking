# Research decisions

## Atomic corrections
Decision: full replacement ExpenseCorrected/IncomeCorrected/TaskCorrected events keyed by existing logical ID, with required correction reason. Fold current projections by ID; retain original events.
Rationale: CommandPipeline appends one event atomically. Reversal plus recreation would require a new transaction model and risk duplicates.
Alternatives: destructive overwrite rejected for auditability; two independent commands rejected for partial failure.

## Partial receipts
Decision: explicit receipt event separate from legacy final approval/rejection. Compute remaining expected minus receipts; final decision stays final. Historical approvals are not reopened.
Rationale: user distinguishes short payment from final settlement. Existing exactly-one-final-decision rule remains compatible.
Alternatives: copy-only settlement explanation fails requested balance support; reinterpreting old approvals changes historical policy.

## Retired care
Decision: allow all supported care/finance/task targeting except Sold; retain schedule obligations.
Rationale: retirement from riding does not end feed/vet needs. No new status enum is needed.

## Frontend boundaries
Decision: normalize ordinary integer ratios deterministically to existing millionth representation before requests; convert euro/km to minor/km only at transport boundary. Keep server allocation authoritative. Cache drafts under signed-in subject and workflow, never previews. Use wrapping native links for mobile discovery.
Rationale: bounded compatible changes reuse exact existing financial policy, browser semantics and components.

## Scope and dependencies
U05/U07 excluded by latest instruction. No blocking product question remains. Real WorkOS logout configuration cannot be verified without hosted settings access; repository should pass an explicit validated return URL and document configuration/verification.
