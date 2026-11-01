# Validation guide

Use Node 24.19.0 from README.md:

```sh
export PATH="$PWD/.local/toolchain/node-v24.19.0-darwin-arm64/bin:$PATH"
npm --prefix frontend run test -- --run tests/components/Settings.test.tsx
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend run test:e2e -- tests/e2e/settings.spec.ts
```

Browser acceptance: at desktop and 375px, open Settings, confirm the saved selection, choose a different zone using the keyboard, save, reload, and confirm persistence and status feedback. Check no page overflow. Also cover empty settings, UTC, saved aliases, pending saves, failed saves, and financial locks in component tests.

Follow the existing feature validation guide at ../001-horse-finance-effort-tracking/quickstart.md. Local UI checks do not satisfy external release gates.

## Local evidence — 2026-11-01

- Specification quality: 16/16 checks passed. All six implementation tasks completed.
- Red: six component tests failed because Time zone was a textbox rather than a combobox.
- Green: all six settings component tests passed, covering selection/save, worldwide options, UTC, aliases, empty state, financial locking, pending save and failure/retry.
- Pinned Node 24.19.0: frontend build/typecheck and lint passed.
- Existing affected browser suites: seven tests passed across private-ledger and driving, including first-time account setup and real backend expense/driving journeys. Updated the old text-fill action to select an option.
- New settings browser tests: 2/2 passed at 1280px and 375px using native keyboard type-ahead (`u` chooses UTC), Tab and Enter to save, changing to America/New_York, and reloading to verify persistence. These tests use isolated intercepted account responses; they do not add backend timezone-validation evidence.
- Desktop and mobile screenshots visually inspected; no page overflow, readable field labels and helper text, existing card and control styling retained. Screenshots were generated in temporary storage.
- Browser fixture setup initially rejected arbitrary users; the new UI tests now use independent intercepted responses to avoid depending on the fixture's shared financial accounts. Platform-native type-ahead is used because End did not change this native select in the browser harness.
- No external release readiness claims; original feature release gates remain separate.
