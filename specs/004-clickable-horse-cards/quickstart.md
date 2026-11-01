# Validation quickstart

Use the Node 24.19.0 runtime pinned in README.md; install frontend dependencies with `npm ci`.

From `frontend/`:

```sh
npm run test:e2e -- horse-cards.spec.ts
npm test -- --run
npm run build
npm run lint
npm run format:check
```

The browser runner starts isolated API/frontend services. The card regression uses deterministic synthetic responses to isolate navigation. Verify content and padding clicks, keyboard Enter, native modified click, translated labels and no overflow at 375px and 1440px. Screenshots are written under `frontend/test-results/`. See `validation.md` for evidence and existing release-gate limits under `../001-horse-finance-effort-tracking/`.
