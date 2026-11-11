# Tasks: Usability remediation

Input: spec.md, plan.md, research.md, data-model.md and contracts/remediation.md. Tests are required by the constitution. Scope: 24 findings; U05/U07 excluded.

## Phase 1: Setup
- [x] T001 Preserve and inspect docs/usability/2026-11-10-horse-owner-usability-test.md and linked screenshots; read README.md and docs/design-system.md.
- [x] T002 Define compatible domain and UI contracts in specs/005-usability-remediation/contracts/remediation.md.

## Phase 2: Foundation
- [x] T003 Verify pinned runtime and baseline checks in frontend/package.json and backend/CostTracking.slnx; record evidence in specs/005-usability-remediation/validation.md.

## Phase 3: US1 reliable entry (P1)
Independent test: exact ratio/mileage previews, three task saves, retired care and reasoned corrections reconcile once.
- [x] T004 [US1] Add failing ratio and euro-rate regressions in frontend/tests/components/FinancialForm.test.tsx and DrivingForm.test.tsx (U01/U02).
- [x] T005 [US1] Normalize ratios in frontend/src/features/finance/useFinancialForm.ts and convert major-unit rates in frontend/src/features/driving/DrivingForm.tsx and DrivingRateForm.tsx (U01/U02).
- [x] T006 [US1] Reproduce consecutive-task conflict, implement account refresh/reset and draft-preserving conflict recovery in frontend/src/routes/tasks.tsx and features/tasks/TaskForm.tsx (U03/U16).
- [x] T007 [US1] Add correction schema/HTTP/replay tests in backend/tests before extending specs/001-horse-finance-effort-tracking/contracts/events-v1.schema.json and backend/src/CostTracking.Api/Storage/EventSerializer.cs (U04/U16).
- [x] T008 [US1] Implement correction projections, server preview deltas and endpoints in backend/src/CostTracking.Api/Domain and Features/{Expenses,Income,Tasks,Previews} (U04/U16).
- [x] T009 [US1] Expose previewed financial and reasoned task corrections in frontend/src/routes/{expenses,income,tasks}.tsx and regenerate frontend/src/api/schema.d.ts (U04/U16).
- [x] T010 [US1] Test and implement Retired care eligibility in backend/src/CostTracking.Api/Features, Domain/HorseTask.cs and frontend/src/features/finance/SplitFields.tsx; retain Sold restrictions (U13).

## Phase 4: US2 reconciliation (P2)
Independent test: bounded monthly day-10 preview, partial €140 + €10, legacy final decision and previous-month ledgers.
- [x] T011 [US2] Add failing bounded-summary/scheduled-example regressions in frontend/tests/components/IncomeRuleList.test.tsx and IncomeRuleForm.test.tsx (U08/U09/U10).
- [x] T012 [US2] Implement schedule occurrence helper and complete summaries in frontend/src/features/{recurrence,incomeRules,expenseRules} (U08/U09/U10).
- [x] T013 [US2] Add partial-receipt/final-compatibility/race/replay tests in backend/tests before implementing receipt event schema, projections and endpoints in backend/src/CostTracking.Api/Features/IncomeRules and Domain/{Income,PendingIncome}.cs (U11).
- [x] T014 [US2] Add explicit partial/final receipt choices, outstanding balances and decision history in frontend/src/features/approvals/IncomeDecisionDialogs.tsx and routes/approvals.tsx; regenerate frontend/src/api/schema.d.ts (U11/U12).
- [x] T015 [US2] Add month selection and selected-horse report links in frontend/src/routes/{expenses,income,reports}.tsx with affected regression checks (U14).

## Phase 5: US3 clarity and recovery (P3)
Independent test: same-subject draft restoration, quantity-only summaries, visible phone navigation/totals, focused forms and useful audit details.
- [x] T016 [US3] Test and implement subject-scoped draft retention without preview persistence in frontend/src/features/finance/useFinancialForm.ts, driving/DrivingForm.tsx and tasks/TaskForm.tsx (U15).
- [x] T017 [US3] Test quantity summaries then extend backend/src/CostTracking.Api/Features/Reports/ActivityReportEndpoints.cs and frontend/src/features/reports/ActivitySummary.tsx and routes/tasks.tsx (U17).
- [x] T018 [US3] Test and implement mobile navigation, report scroll cue and monthly/lifetime totals in frontend/src/components/AppShell.tsx, styles.css and features/reports (U18/U19/U23).
- [x] T019 [US3] Supplement and render history detail in backend/src/CostTracking.Api/Features/History/HistoryEndpoints.cs and frontend/src/routes/{settings,horses.$horseId}.tsx (U20).
- [x] T020 [US3] Test and implement mutually exclusive cancellable focused forms with unique IDs in frontend/src/routes/{expenses,income}.tsx and features/finance/SplitFields.tsx (U21).
- [x] T021 [US3] Apply unambiguous dates, onboarding, familiar terms and field guidance in frontend/src/i18n/{format,messages}.ts, routes/horses.tsx and affected forms (U22/U24/U25/U26).
- [x] T022 [US3] Test and implement repository-side safe logout return in backend/src/CostTracking.Api/Auth/SessionEndpoints.cs; document exact external configuration/verification in specs/005-usability-remediation/validation.md without changing sign-in routing (U06).

## Phase 6: Validation and polish
- [x] T023 Update docs/design-system.md for reusable entry, navigation, draft and report patterns; keep bilingual copy complete in frontend/src/i18n/messages.ts.
- [x] T024 Run backend/frontend/contracts/typecheck/lint/build and affected browser checks; record commands, failures and final results in specs/005-usability-remediation/validation.md.
- [x] T025 Inspect populated/empty/error layouts at desktop/680px/390px and keyboard flows with isolated data; retain evidence under specs/005-usability-remediation/validation (no human-study or release-readiness claim).
- [x] T026 Run speckit-converge against specs/005-usability-remediation/{spec,plan,tasks}.md; implement any appended tasks and produce U01–U26 status with external dependencies.

## Dependencies and execution
Setup → foundation → US1 → US2 → US3 → validation/convergence. Within each slice observe regression red before implementation, then verify green. US1 is the minimum useful increment, but the authorized outcome includes all three stories. No deployment/merge.

Independent checks may run in parallel: frontend ratio/mileage tests and backend correction tests (US1); schedule UI checks and receipt domain tests (US2); report/navigation checks and history checks (US3). Mutations of shared schema/API files remain sequential. Each task is traceable to findings or cross-cutting validation. No implementation agents are required.

## Phase 7: Convergence

- [x] T027 Fix payment-editor reset after a partial receipt and add a named confirmation/history link in frontend/src/routes/approvals.tsx per U11/U12 (partial).
- [x] T028 Retain recurring-rule drafts by subject and rule identity and reject corrupted draft structures in frontend/src/features/{finance/useDraftState,expenseRules/ExpenseRuleForm,incomeRules/IncomeRuleForm}.tsx per U15 and edge cases (partial).
- [x] T029 Replace remaining ISO month captions and scheduling/contribution jargon in frontend/src/features and routes/horses.$horseId.tsx per U22/U25 (partial).
- [x] T030 Render category, quantities and individual allocation detail alongside retained summaries in frontend/src/components/HistoryDetails.tsx per U20 (partial).
- [x] T031 Add edge/replay/receipt-reset/draft-isolation acceptance checks in backend/tests and frontend/tests and complete populated/empty/error desktop and phone captures per SC-001/SC-004 and plan validation (partial).

## Phase 8: Financial convergence

- [x] T032 Include correction/receipt dates in backend/src/CostTracking.Api/Features/Reports/FinancialReportEndpoints.cs lifetime bounds and use exact integer aggregation/display in frontend/src/features/reports/{PnlTable,LifetimeTable}.tsx per SC-002 and U04/U23 (partial).

- [x] T033 Resolve upcoming schedule dates centrally across future revisions/stops in backend/src/CostTracking.Api/Domain/ScheduleExpansion.cs and render explicit upcoming/stop labels in frontend/src/features/recurrence/ScheduleSummary.tsx per U10 (partial).

## Phase 9: Split editor convergence

- [x] T034 Present saved custom allocations as readable percentage shares, accepting exact decimal ratios at the transport boundary in frontend/src/features/finance/normalizeSplit.ts and frontend/src/features/finance/SplitFields.tsx, and verify saved-split editor round trips per U01/U25 (partial).

Final convergence: all initial 34 tasks completed for repository scope. U05/U07 remain excluded. U06 hosted configuration/verification is the explicit external dependency documented in validation.md; no additional repository task remains.

## Phase 10: PR review hardening

- [x] T035 Keep the task's original sold horse alongside eligible replacements in frontend/src/routes/tasks.tsx and cover correction without reassignment in frontend/tests/components/TaskCorrection.test.tsx (U13/U16; PR review finding 4535134857).
- [x] T036 Clear cached correction commands after definitive version conflicts in frontend/src/features/tasks/TaskCorrection.tsx; verify fresh unchanged-draft retries and original-key ambiguous-save retries in frontend/tests/components/TaskCorrection.test.tsx (U03/U16; PR review finding 4535134864).

- [x] T037 Replay actual event allocations for approved payments and partial receipts in backend/src/CostTracking.Api/Features/IncomeRules/IncomeApprovalEndpoints.cs; retain rule defaults for rejections and cover both payment kinds in backend/tests/CostTracking.Tests/Integration/RecurringIncomeTests.cs (U11/U12/U20; PR review finding 4542464189).

- [x] T038 Search successive bounded windows for recurring preview examples in backend/src/CostTracking.Api/Features/Previews/FinancialPreviewEndpoints.cs and remove the frontend five-year cutoff in frontend/src/features/recurrence/schedule.ts; cover long intervals, inclusive ends and calendar exhaustion (U09/U10; PR review finding on FinancialPreviewEndpoints.cs).
