# Tasks: Horse-head icons

**Input**: [plan.md](plan.md), [spec.md](spec.md), research.md, data-model.md, contracts/icons.md.

## Phase 1: Setup

- [x] T001 Read design system and constitution; inventory icon surfaces in frontend/src/components/Icon.tsx and frontend/index.html.

## Phase 2: Foundation

- [x] T002 Define static asset contract in specs/004-horse-head-icons/contracts/icons.md and pass specification checklist.

## Phase 3: US1 - Recognize workspace (P1, MVP)

**Goal**: Consistent decorative horse head in brand and Horses navigation.
**Independent test**: Inspect both uses and accessible home/navigation labels.

- [x] T003 [US1] Add failing shared-icon reference test in frontend/tests/components/BrandIcons.test.tsx.
- [x] T004 [US1] Add canonical frontend/public/horse-head.svg and reference it from frontend/src/components/Icon.tsx.

## Phase 4: US2 - Recognize shortcuts (P2)

**Goal**: Browser and device assets show the same profile.
**Independent test**: Load declared resources and verify types, sizes, and canonical geometry.

- [x] T005 [US2] Add failing document/asset delivery tests in frontend/tests/components/BrandIcons.test.tsx.
- [x] T006 [US2] Generate favicon and device assets using scripts/generate-icons.mjs; declare frontend/index.html metadata and frontend/public/site.webmanifest.
- [x] T007 [US2] Exclude manifest from fallback in frontend/public/staticwebapp.config.json.

## Phase 5: Polish and validation

- [x] T008 Document horse icon pattern and regeneration in docs/design-system.md.
- [x] T009 Run pinned frontend build, lint, formatting and tests; inspect production UI at desktop/mobile and record specs/004-horse-head-icons/validation.md.

## Dependencies & Execution Order

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009.
US1 is the workspace MVP; US2 adds shortcut recognition. Deliver both in this change.

## Parallel opportunities

After T004, documentation in docs/design-system.md and US2 metadata can be prepared independently; execute sequentially here. No agent delegation is needed.

## Implementation strategy

Follow red-green-refactor per story, validate the production integration, then commit and open a PR. CI monitoring and auto-merge are delivery actions after local validation.
