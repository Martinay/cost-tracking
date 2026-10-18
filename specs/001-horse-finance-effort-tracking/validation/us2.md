# User Story 2: Plan recurring costs

**Local acceptance: verified.** The HTTP-backed browser journey creates a recurring expense rule, checks server-generated occurrence rows, changes one date, skips and restores another, queues a future revision, and stops the rule inclusively. Persisted rules and occurrence rows are read back through HTTP. The final browser suite passed 21/21; the local frontend suite passed 68/68, and generated contract checks passed 42/42 with no drift. See [frontend-journeys.md](frontend-journeys.md), [backend-acceptance.md](backend-acceptance.md#backend-and-shared-api-work), and the recorded full-suite results in [implementation.md](implementation.md).

The recurrence remains virtual: ordinary occurrences and reads append no events. Changed and skipped states are visible; restoring a skipped date does not alter neighboring dates. Calendar expansion, date bounds, protected revisions/stops, ownership, and candidate-budget behaviors are covered by the schedule and recurring-expense domain/integration suites. Azure Files semantics remain unverified.

Historical red-first evidence for T046–T048 was not retained, so those test-authoring tasks remain unchecked. The final green suite is not claimed as proof of a missing earlier red. No local story acceptance failure remains recorded; target-share behavior is an external release gate.
