# Validation guide
Use the pinned Node runtime in README.md and existing frontend dependencies.

1. From frontend, run `npm test -- --run`, `npm run lint`, and `npm run build`.
2. Run `npm run test:e2e -- recurring-expenses.spec.ts private-ledger.spec.ts` for the existing HTTP-backed harness.
3. In the running app, open Expenses. Open Category on a recurring expense and select Feed; complete the schedule, amount, description and split; preview. Change Category to Veterinary and verify preview invalidation, then preview again and create.
4. Open a rule revision and occurrence editor. Verify the existing selection and identical choices. Check a one-off expense too.
5. Check keyboard selection, associated label/help and focus at desktop and 375px. Verify no page overflow.

Record actual outcomes and unavailable checks in validation.md. Local checks do not establish release readiness.
