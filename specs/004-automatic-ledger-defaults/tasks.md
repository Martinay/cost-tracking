# Tasks: Automatic ledger defaults

## Phase 1: Setup
- [x] T001 Specify scope and validate requirements in specs/004-automatic-ledger-defaults/spec.md and checklists/requirements.md.

## Phase 2: Foundation
- [x] T002 Document legacy replay and API policy in specs/004-automatic-ledger-defaults/research.md, data-model.md and contracts/account.md.

## Phase 3: US1 — Start immediately
Independent check: empty stream stays version zero; owner adds horse and records EUR finances without configuration.
- [x] T003 [US1] Add failing default-account and EUR command tests in backend/tests/CostTracking.Tests/Domain/AccountHorseProjectionTests.cs and Integration/AccountHorseTests.cs.
- [x] T004 [US1] Default absent currency to "EUR" and timezone to "UTC" in backend/src/CostTracking.Api/Domain/AccountProjection.cs; enforce new request currency MUST equal "EUR" in Features/Account/AccountEndpoints.cs without changing historical serializer validation.
- [x] T005 [US1] Replace preference tests with no-setup assertions in frontend/tests/components/Settings.test.tsx and affected frontend/tests/e2e/ journeys.
- [x] T006 [US1] Remove preferences controls and horse setup gate in frontend/src/routes/settings.tsx and horses.tsx; localize explanatory text in frontend/src/i18n/messages.ts.
- [x] T007 [US1] Update superseded command/setup assertions in backend/tests/CostTracking.Tests/Integration/ and verify fresh-account financial workflow.

## Phase 4: US2 — Read local time
Independent check: same UTC event displays in two local timezones while date-only values remain unchanged.
- [x] T008 [US2] Verify UTC history display and date-only preservation in frontend/tests/e2e/settings.spec.ts with browser timezone contexts and existing frontend/tests/components/I18n.test.tsx coverage.

## Phase 5: Polish
- [x] T009 Update current behavior in README.md and docs/design-system.md, marking specs/002-timezone-dropdown/spec.md as superseded by this feature.
- [x] T010 Run backend/frontend checks and desktop/mobile journeys; record evidence in specs/004-automatic-ledger-defaults/validation.md and mark completed tasks.

## Dependencies and execution
T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010. US2 relies on US1 settings presentation. Complete US1 as the MVP, then verify local timestamp behavior. Backend and frontend regression preparation could run in parallel because they touch different files; no parallel implementation agents are needed.
