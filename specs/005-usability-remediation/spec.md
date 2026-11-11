# Feature Specification: Usability remediation

**Feature Branch**: `codex/usability-remediation`
**Created**: 2026-11-11
**Status**: Implemented and locally validated; U06 hosted verification pending
**Input**: Remediate the live owner walkthrough, excluding U05 and U07 by explicit user instruction.

## User Scenarios & Testing

### User Story 1 - Reliably record money and care (Priority: P1)
An owner records shared bills, mileage and several care tasks, then corrects mistakes without losing the audit trail.
**Why this priority**: These actions currently block daily entry or risk incorrect money.
**Independent Test**: Record a 2:1 bill, €0.30/km trip and two tasks, then correct each record and reconcile reports.
**Acceptance Scenarios**:
1. Given a €60 bill and ratios 2:1, preview shows €40/€20 and saving retains that exact total.
2. Given 24 km and €0.30/km, preview and saved expense equal €7.20.
3. Given a successful task save, another valid task saves immediately; a genuine conflict keeps its draft.
4. Given a saved one-off record, a reasoned correction changes current reports once while history retains original and replacement.

### User Story 2 - Reconcile schedules and receipts (Priority: P2)
An owner verifies when payments recur, records partial money received and reviews prior months and decisions.
**Why this priority**: Reconciliation requires visible schedules, balances and history.
**Independent Test**: Create a monthly rule due on day 10 with a bounded end, receive €140 of €150 as partial and then settle the €10 balance.
**Acceptance Scenarios**:
1. Given a start on day 2 and monthly day 10, the example date is day 10 and the saved summary states day 10 and the actual end.
2. Given explicit partial receipt €140 against €150, income counts €140 and pending shows €10; another receipt of €10 closes the balance exactly once.
3. Given legacy approval €140 against €150, history states final settlement and €10 difference without reopening it.
4. Given October data, both ledgers can browse it and report links preserve the selection.

### User Story 3 - Understand and recover on phones and keyboards (Priority: P3)
An owner discovers navigation, understands totals and quantities, safely leaves a draft and sees meaningful history.
**Why this priority**: Clear recovery and readable presentation make the supported workflows usable.
**Independent Test**: Use populated and error states at desktop and 390px with keyboard navigation; leave and restore a draft under the same subject.
**Acceptance Scenarios**:
1. All navigation destinations are visible or have a labelled menu; totals and scroll instructions are readable on phones.
2. Quantity-only work shows its unit and missing duration, and retired care remains available while sold targeting stays restricted.
3. Opening an entry editor moves focus inside; cancelling closes it; labels remain unique.
4. Signing out clears protected state and returns to a clear signed-out page.

### Edge Cases
- Ratio precision, zero/negative/overflow weights, deterministic ties and one-cent amounts.
- Corrections racing with another command, repeated idempotency keys, unknown/foreign IDs and invalid sold targets.
- Repeated partial receipts, overpayment, final settlement, rejected occurrences and legacy approvals.
- Empty months, leap days, month-end clamping, bounded schedules without valid dates and future revisions.
- Drafts on identity changes, storage failures, corrupted drafts and preview invalidation.

## Requirements

### Functional Requirements and U01–U26 traceability

| Finding | Requirement / acceptance outcome | Scope |
| --- | --- | --- |
| U01 | Accept positive ratios such as 2:1 and readable decimal percentage shares; preview €60 as €40/€20, retaining exact server allocation and deterministic remainder handling. | Required |
| U02 | Accept and display euros per kilometre in trip and default-rate forms; 24 km at €0.30/km previews exactly €7.20. | Required |
| U03 | Save two consecutive tasks without stale versions; preserve a failed draft and provide in-place account refresh on conflicts. | Required |
| U04 | Correct one-off expenses and income through an explicit reason and exact replacement preview; retain original values in immutable history and count only the current correction in reports. | Required |
| U05 | Excluded by user instruction on 11 November 2026; preserve existing behavior. | Excluded |
| U06 | End sign-out on the signed-out application page; supply an explicit safe return URL and document any required hosted configuration. | Required |
| U07 | Excluded by user instruction on 11 November 2026; preserve existing behavior. | Excluded |
| U08 | Show the saved inclusive income end date and distinguish it from a later stop. | Required |
| U09 | Preview the first valid scheduled occurrence on or after the applicable start/effective date; never label a nonscheduled day as an occurrence. | Required |
| U10 | Show repeat interval, selected days, dates, allocation and stop state in current schedule summaries; distinguish revisions. | Required |
| U11 | Support explicitly selected partial receipts with outstanding balances; keep existing decisions final by default and explain expected, received and difference before confirmation. Legacy final settlements remain final. | Required |
| U12 | Expose read-only payment decision history with outcome, dates, horses, expected/actual/difference and correction guidance. | Required |
| U13 | Allow new care expenses, income and tasks for Retired horses; Sold horses remain unavailable for new targeting. Explain this before status changes; preserve recurring obligations. | Required |
| U14 | Browse expenses and income by month, with report-to-ledger links preserving month and selected horse. | Required |
| U15 | Retain meaningful financial and task drafts within the signed-in subject across navigation/reload; never share drafts across identities and never restore a server preview. | Required |
| U16 | Reset task entry after success and expose auditable corrections for horse, date, measurements and notes with a reason. | Required |
| U17 | Aggregate quantities only by identical unit, retain missing-duration information and never describe quantity-only work as measured zero minutes. | Required |
| U18 | Make all seven navigation destinations discoverable at 390px and 680px without unexplained horizontal scrolling. | Required |
| U19 | Show a visible horizontal-scroll instruction for narrow report tables while retaining semantic tables and keyboard regions. | Required |
| U20 | Supplement retained audit summaries with record identifiers, horses, amounts and before/after details where available. | Required |
| U21 | Offer dismissible mutually exclusive entry workflows, focus the opened editor and use unique IDs for repeated fields. | Required |
| U22 | Use unambiguous month-name dates and month captions in visible copy; retain canonical dates/native controls. | Required |
| U23 | Show monthly overall income/expense/net totals and label the lifetime aggregate Total. | Required |
| U24 | Explain adding horses then recording/splitting a first bill in the fresh-account empty state. | Required |
| U25 | Use familiar repeat, split, scheduled and received-payment terminology while retaining exact domain rules. | Required |
| U26 | Identify optional inputs consistently and explain time/quantity alternatives and required units before submission. | Required |

All required findings MUST pass their listed outcomes. Preserve subject isolation, exact server previews, immutable event history, canonical currency/calendar semantics and idempotent/versioned commands. Tests MUST precede production implementation as required by the constitution.

### Key Entities
- Correction: logical record identity, full replacement, required reason, immutable original and correction events.
- Receipt: scheduled occurrence identity, expected amount, received instalments, final/partial settlement choice and remaining balance.
- Draft: subject, workflow, editable fields; excludes preview authorizations and credentials.

## Success Criteria

### Measurable Outcomes
- SC-001: All 24 in-scope findings have an implemented acceptance check or a precisely documented external authentication dependency.
- SC-002: Every saved and corrected financial fixture reconciles income minus expenses to net exactly, without duplicate realization.
- SC-003: Three consecutive task entries succeed without reload in the isolated local account.
- SC-004: All seven destinations and overall monthly result are discoverable at desktop and phone sizes with keyboard access.
- SC-005: No original usability evidence or unrelated user data is modified.

## Assumptions
- U05 and U07 are explicitly excluded; no stable/ownership model or sign-in routing change is authorized.
- Partial receipt is explicit opt-in; existing approvals retain their final-settlement meaning. No historic decision is silently reopened.
- Retired means care continues; Sold restricts new targets. Existing recurring obligations remain governed by their saved rules.
- Corrections append a replacement with a reason; they never delete or rewrite events.
- Hosted logout settings may require account-owner action. Repository fixes and exact instructions are deliverable independently.
- No direct deployment, production-account mutation or human-study/release-readiness claim is included. The user subsequently authorized creating a PR and enabling auto-merge after completion and required checks.
