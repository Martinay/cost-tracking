# Validation
Use the pinned runtime in README.md. From frontend: `npm exec vitest run`, `npm run lint`, `npm run build`, `npm run format:check`. Run browser acceptance via `npm run test:e2e -- --grep 'quick task|task|activity'` (see scripts/run-e2e.mjs for harness arguments).

In the running app at desktop and 375px: choose a horse; create Putzen / Grooming / 15; apply and save; verify recent tasks and summary; add Reiten / Riding / 45 and Longieren / Lunging / 20; edit/reuse/delete; reload; test Escape focus recovery and keyboard submission. Confirm no quantity controls, no page overflow and retained draft on failure. Existing release gates remain unchanged.
