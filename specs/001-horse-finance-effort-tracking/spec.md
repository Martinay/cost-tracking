# Feature Specification: Horse Finance and Effort Tracking

**Feature Branch**: `main` (no branch hook configured)

**Created**: 2026-09-21

**Status**: Draft, ready for planning

**Input**: User's attached platform brief. The requested architecture and technical contracts are in [architecture.md](architecture.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep a private horse ledger (Priority: P1)

An owner registers horses, records expenses and one-time income against one or more horses, and sees private monthly and lifetime balances.

**Why this priority**: This is the smallest useful accounting workflow and establishes the privacy boundary.

**Independent Test**: Register two horses, record a split expense and one-time income, inspect both ledgers, and attempt access from a second owner's account.

**Acceptance Scenarios**:

1. **Given** two active horses, **When** the owner records a €10.01 expense split equally, **Then** all €10.01 is allocated exactly once and each horse's share is visible.
2. **Given** a horse with existing entries, **When** the owner marks it Sold, **Then** historical entries and lifetime totals remain available.
3. **Given** two signed-in owners, **When** either requests a horse, entry, report, or approval belonging to the other, **Then** no other owner's content or existence is disclosed.
4. **Given** a one-time income item, **When** it is recorded, **Then** it immediately counts as realized income without approval.

---

### User Story 2 - Plan recurring costs (Priority: P2)

An owner creates recurring expense rules, sees occurrences in a selected interval, and changes or skips individual dates without changing the rule.

**Why this priority**: Repeating stabling, feed, and care costs are central to ownership.

**Independent Test**: Create a weekday rule, view a bounded period, override one date, and confirm another date is unchanged after a fresh sign-in.

**Acceptance Scenarios**:

1. **Given** a Monday and Thursday expense rule, **When** a two-week interval is opened, **Then** every matching date appears once and no date outside the interval appears.
2. **Given** a generated occurrence, **When** the owner changes its amount, allocation, or category, **Then** only that occurrence changes.
3. **Given** a generated occurrence, **When** the owner skips it, **Then** it contributes zero to totals and is visibly marked skipped.
4. **Given** an unmodified rule, **When** a future period is viewed, **Then** occurrences appear without any scheduled preparation.

---

### User Story 3 - Confirm recurring payments (Priority: P2)

Due recurring income appears in an approval inbox until the owner approves, adjusts and approves, or rejects it. Only approved payments count as realized income.

**Why this priority**: Expected income must not be confused with money received.

**Independent Test**: Create a due rule, process separate dates using all three decisions, and reconcile the inbox with realized P&L.

**Acceptance Scenarios**:

1. **Given** an undecided due payment, **When** the inbox opens, **Then** it appears once as pending and is absent from realized income.
2. **Given** a pending payment, **When** it is approved, **Then** it leaves the inbox and appears once in the realized ledger.
3. **Given** a pending payment, **When** actual amount, received date, or split is edited and approved, **Then** reports use the actual values.
4. **Given** a pending payment, **When** it is rejected, **Then** it leaves the inbox, remains auditable, and contributes zero to realized income.
5. **Given** a processed date, **When** the next due date arrives, **Then** that payment is offered independently.

---

### User Story 4 - Record driving and effort (Priority: P3)

An owner records a trip's distance and rate as an allocated cost and logs horse activities without changing financial balances.

**Why this priority**: Transport and non-financial care complete the ownership record.

**Independent Test**: Log one trip and one activity; verify the trip changes P&L and the activity changes only the activity report.

**Acceptance Scenarios**:

1. **Given** a distance and rate, **When** driving is recorded, **Then** the cost and split are shown before confirmation and in the ledger afterward.
2. **Given** a Riding task, **When** it is logged, **Then** its details appear in activity reports without changing balances.

---

### User Story 5 - Understand trends (Priority: P3)

An owner compares monthly net margin, lifetime balances, expense categories, income sources, and task volume by horse.

**Why this priority**: Reports make recorded data actionable.

**Independent Test**: Record items across two months and horses, then reconcile reports against individual allocations.

**Acceptance Scenarios**:

1. **Given** approved income and expenses, **When** monthly P&L opens, **Then** each horse's net margin equals allocated realized income minus allocated expenses for that month.
2. **Given** tasks of different types, **When** activity reporting opens, **Then** counts and durations match the task log.

### Edge Cases

- Indivisible cents are assigned deterministically; allocated amounts always sum to the original.
- Invalid amounts, percentages, duplicate targets, and unknown horses receive field-specific errors.
- A monthly due day absent from a month moves to that month's last day, including leap-year cases.
- Rules have inclusive start and optional inclusive end dates. Empty or excessive query intervals are rejected clearly.
- Repeated inbox refreshes cannot duplicate a pending payment; simultaneous decisions accept exactly one outcome.
- Sold and Retired horses retain history but are unavailable for new entries.
- Storage failure yields a retryable error and no false success message.
- Owner time zone defines due and reporting dates; daylight saving changes do not duplicate calendar dates.
- Driving cost is rounded once to currency precision before allocation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Authenticate an owner and scope every read, write, report, and decision to that owner.
- **FR-002**: Let an owner register and update horses with name, breed, date of birth, and Active, Leased, Retired, or Sold status while retaining all history.
- **FR-003**: Record dated one-time expenses with amount, currency, category, description, and horse allocations.
- **FR-004**: Support Stabling, Veterinary, Farrier, Feed, Equipment, Training, Driving, and Other expense categories.
- **FR-005**: Allocate expenses and income equally or by custom fractional shares that sum to 100%; monetary shares MUST sum exactly to the item amount.
- **FR-006**: Record driving costs from kilometers and an owner-configurable rate per kilometer, rounded once to currency precision.
- **FR-007**: Create, change for future occurrences, and stop recurring expense rules with daily, weekly, selected-weekday, and monthly schedules.
- **FR-008**: Derive recurring expense occurrences for a requested interval without storing ordinary generated occurrences as ledger entries.
- **FR-009**: Change or skip a single recurring expense occurrence while preserving its parent rule and other dates.
- **FR-010**: Record one-time income with source, received date, amount, and allocations and count it immediately as realized.
- **FR-011**: Create, change for future occurrences, and stop recurring income rules with cadence, due dates, amount, source, and allocations.
- **FR-012**: Show every due, undecided recurring income occurrence once in a pending inbox and exclude it from realized income.
- **FR-013**: Approve, edit and approve, or reject a pending occurrence; accept exactly one final decision per rule and scheduled date.
- **FR-014**: Record actual received date, amount, and allocation on approval and zero realized value on rejection; allow subsequent due dates after either decision.
- **FR-015**: Log a dated, horse-specific task with type, minutes or quantity, and optional notes. Types include Riding, Groundwork, Lunging, Grooming, Medical Care, Paddock Duty, Transportation, and Other.
- **FR-016**: Keep tasks entirely outside financial calculations.
- **FR-017**: Show monthly P&L, lifetime balance, expense category and income source breakdowns, and activity volume by type for each horse.
- **FR-018**: Calculate reports from allocated realized income and allocated expenses; exclude pending and rejected income.
- **FR-019**: Retain an auditable chronological history of accepted changes and decisions.
- **FR-020**: Reject conflicting simultaneous changes with a recoverable conflict response rather than silently overwrite them.
- **FR-021**: Show confirmation, validation errors, loading state, and retry paths, with keyboard operation and accessible labels and status messages.
- **FR-022**: Preserve accepted data across restarts and report storage failures without claiming success.
- **FR-023**: Establish an account currency and time zone before the first financial entry.

### Key Entities

- **Owner account**: Private boundary for data, currency, and time zone.
- **Horse**: Identity, descriptive details, lifecycle status, and retained history.
- **Allocation**: Horse, fractional share, and exact monetary result of a financial item.
- **Expense**: One-time cost, including driving, with date, category, and allocations.
- **Recurring expense rule and occurrence**: Schedule and defaults, plus date-specific virtual or overridden result.
- **Income**: Realized one-time receipt with source, date, and allocations.
- **Recurring income rule and decision**: Schedule and expected receipt, plus pending, approved, or rejected outcome per due date.
- **Task log**: Dated non-monetary activity with type and effort.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of new owners register a horse and record a split expense without instructions within five minutes in usability testing.
- **SC-002**: In at least 99% of standard interactive sessions, a requested month of ledger and reports becomes visible within two seconds after the account is ready; cold starts are measured separately.
- **SC-003**: In 100% of tested entries, allocation shares total 100%, allocated cents total the original, and net margin reconciles to ledger items.
- **SC-004**: In 100% of cross-account tests, one owner cannot see or change another owner's records through any identifier.
- **SC-005**: In 100% of tested schedules, generated dates match the cadence and unchanged expense occurrences do not become permanent transactions.
- **SC-006**: In 100% of tested recurring income decisions, pending income is excluded from realized totals and each date has at most one final decision.
- **SC-007**: In a 20-user usability test, at least 90% distinguish pending income, realized income, and skipped expenses from visible labels without help.
- **SC-008**: An account with 100 horses and 5,000 changes retains all accepted entries across restart and recovery exercises.

## Assumptions

- One signed-in user is one private owner account. Sharing, organization-level access, and delegation are out of scope.
- Each account uses one ISO 4217 currency, initially EUR unless selected before the first financial entry. Currency conversion and tax accounting are out of scope.
- Monetary inputs are nonnegative and expense and income amounts must be positive. Corrections to committed one-time entries are a later feature; their original records remain auditable.
- Dates follow the owner's IANA time zone. Approved income reports use actual received date, not scheduled due date.
- New entries target Active or Leased horses. Retired and Sold horses remain reportable.
- Date-range queries are capped at five years and 10,000 generated occurrences per request.
- Effort duration is recorded in minutes; optional quantity has a user-visible unit. Reports count tasks and sum duration.
- The requested stack, Azure deployment, storage design, and technical contracts are in [architecture.md](architecture.md). The under-$5/month budget requires a region-specific estimate and measured usage before it can be promised.
