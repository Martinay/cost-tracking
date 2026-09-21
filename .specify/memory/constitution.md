<!--
Sync Impact Report
- Version change: unversioned template → 1.0.0
- Modified principles: template placeholders → seven project principles (initial adoption)
- Added sections: Engineering Constraints; Development Workflow; Governance rules
- Removed sections: none
- Follow-up TODOs: none
-->
# Cost Tracking Constitution

## Core Principles

### 1. Radically Simple Solutions (KISS & YAGNI)

- Solutions MUST use the simplest viable approach that satisfies the current specification.
  Do not add abstractions for hypothetical features.
- Do not introduce factories, adapters, strategies, observers, or similar patterns unless at
  least two distinct, concrete callers currently require them.
- Prefer standard language and platform primitives over external libraries for trivial utilities.
- Keep control flow flat. Use early guards instead of nesting conditional blocks more than two
  levels deep.

These rules keep the code proportional to requirements that exist today.

### 2. Single Source of Truth (DRY)

- Core domain rules, calculations, and normalization MUST have one canonical implementation.
- Derive client models, transfer objects, and persistence representations from one canonical
  type or schema wherever the technology permits.
- Do not extract a shared helper for a small repeated pattern until it appears in three distinct
  call sites. Prefer local duplication to an abstraction that obscures domain differences.

These rules prevent conflicting business behavior while avoiding premature generalization.

### 3. Zero-Noise Commentary (Self-Documenting Code)

- Names and type signatures MUST communicate intent. Comments MUST NOT merely restate what the
  code does or how an obvious operation works.
- Comments MAY explain non-obvious business requirements, edge cases, protocol or hardware
  constraints, and deliberate workarounds for external defects.
- Do not add file or function changelogs, author watermarks, or decorative banner comments.
- Document exported public APIs with input constraints and side effects. Internal helpers MUST
  rely on expressive names and type signatures rather than routine docstrings.

These rules keep explanations focused on information the code cannot express on its own.

### 4. High Maintainability & Low Cognitive Load

- Functions SHOULD have one clear responsibility, explicit inputs and outputs, and minimal
  mutable outer-scope state; deviations require a concrete reason in review.
- Configuration, dependencies, and data flow MUST be traceable. Do not use implicit global state,
  dynamic property injection, or reflection that hides dependencies.
- Do not swallow errors or use a generic catch without narrowing, adding context, and surfacing
  or deliberately handling the failure.

These rules make behavior and failures easier to inspect and change.

### 5. High Testability by Design (Deterministic & Isolated)

- Separate core business logic from network, disk, clock, and randomness boundaries so domain
  logic runs in memory without those services.
- Pass external dependencies into business logic through parameters or constructors; do not
  instantiate external clients or access global state inside domain logic.
- Tests MUST assert observable outputs, states, or protocol contracts rather than private methods
  or exact internal call sequences. Avoid deep mock chains.
- Tests MUST be order-independent and deterministic. Do not rely on arbitrary sleeps, timing
  delays, or machine-specific environment state.

These rules make failures reproducible and tests resilient to internal refactoring.

### 6. Strict Test-Driven Development (TDD: Red-Green-Refactor)

- Before writing production implementation code, write an automated test for the requirement
  and observe it fail for the expected reason.
- Write only the production code needed to make the failing test pass. Do not add speculative
  behavior, fields, or helpers during this phase.
- Refactor only while the test suite remains green; use this phase to remove duplication,
  simplify code, and remove comments that merely explain mechanics.
- Before fixing a bug, add a regression test that reproduces it and observe the failure.

The red-green-refactor sequence provides evidence that each change is required and verified.

### 7. Implementation Approach (Spec-First & Thin Vertical Slices)

- Define contract schemas, data shapes, and acceptance criteria in the specification before
  writing tests or implementation.
- Build features as thin end-to-end slices: contract, failing test, domain behavior, then
  integration. Each slice MUST be testable independently.
- Validate integration wiring with a minimal end-to-end happy path, then add edge cases,
  validation, and error paths incrementally.
- Commits and pull requests MUST contain only changes needed for the current task. Do not make
  unrelated formatting or refactoring changes.

These rules expose integration problems early and keep review scope clear.

## Engineering Constraints

- A new dependency MUST solve a concrete requirement that standard platform capabilities do
  not address adequately; record that reason in the change review.
- A domain rule or data shape change MUST update its canonical definition and affected contract
  tests in the same slice.
- External effects MUST stay at explicit boundaries so tests can substitute deterministic
  implementations.

## Development Workflow

1. Specify the current slice's contract, data shape, and acceptance criteria.
2. Add a behavior or regression test and confirm it fails for the intended reason.
3. Implement the smallest change that passes the test; run the relevant tests.
4. Refactor with tests green, then verify the slice through its integration path.
5. Review the diff for scope, duplicated domain logic, hidden dependencies, and constitution
   compliance before merging.

## Governance

- This constitution governs project specifications, plans, implementation, and reviews. When a
  lower-level practice conflicts with it, the constitution takes precedence.
- Amendments MUST be proposed as a documented change to this file, explain the reason and
  migration impact, and receive maintainer approval through the normal review process.
- Version amendments using semantic versioning: MAJOR for incompatible principle removals or
  redefinitions; MINOR for new principles, sections, or materially expanded guidance; PATCH
  for clarifications and editorial changes without a change in meaning.
- Every change review MUST check the applicable principles and document any justified exception
  before merging. Exceptions do not amend the constitution.
- Update the version and Last Amended date with each approved amendment. Preserve the original
  Ratified date. Remove the temporary Sync Impact Report before committing the amendment.

**Version**: 1.0.0 | **Ratified**: 2026-09-21 | **Last Amended**: 2026-09-21
