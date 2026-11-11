# Data model

Correction variants reuse original record identity and complete validated replacement payload, plus reason (trimmed, required, maximum 500 characters). They require an existing one-off record; record list/report projections expose the latest version only. Original immutable event history remains readable. Financial preview returns replacement allocations and monthly deltas subtracting prior and adding replacement, including different months.

Receipt event contains receipt ID, rule ID, scheduled date, received date, positive amountMinor, source snapshot, splitMode, allocations. Remaining balance = scheduled expected amount minus sum(receipts); never negative. Receipt commands reject decided occurrences, excess receipts and invalid schedule dates. Fully paid occurrences no longer pending. Final approvals/rejections retain their existing meanings; explicit final settlement after partials counts only additional actual money. Saved receipt dates protect schedule revisions/stops. Currency and allocation totals remain exact integers.

Task replacement retains taskId with reason and validated horse/date/type/duration/quantity/unit/notes. Missing minutes stay null; quantities aggregate by exact matching unit, never across units.

Draft state is keyed by subject and workflow and contains only editable inputs. Restoring a draft requires a fresh preview; malformed/unsupported storage is recoverable. No credentials or auth tokens are persisted.
