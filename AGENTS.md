# Repository guidance

## Frontend design

Before changing any frontend UI, read and follow [the Horse ledger design system](docs/design-system.md). It defines the visual direction, tokens, shared components, responsive layouts, interaction states, and accessibility requirements.

Use `frontend/src/styles.css` as the canonical token implementation and reuse the components in `frontend/src/components/`. Keep the design document current when introducing reusable patterns. Preserve existing financial rules, authentication boundaries, subject-scoped caches, accessible labels, and server-calculated previews.

## Validation

Use the pinned Node runtime described in `README.md`. Run the frontend build, lint, and affected tests for UI changes. Inspect broad layout changes at desktop and mobile widths. Follow the feature specification and existing validation guidance under `specs/001-horse-finance-effort-tracking/`; do not claim release readiness from local UI checks.
