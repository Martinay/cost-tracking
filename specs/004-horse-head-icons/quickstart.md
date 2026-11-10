# Validation

Use README's pinned Node 24.19.0 runtime. From repository root:

```sh
npm --prefix frontend ci
npm --prefix frontend run test -- --run tests/components/BrandIcons.test.tsx
node scripts/generate-icons.mjs
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend run format:check
npm --prefix frontend run test -- --run
```

Run the production preview and inspect the brand, horse navigation, 16px favicon, and device assets at desktop and 375px mobile widths. Confirm labels, keyboard access, asset media types, and no page overflow. Regenerate assets after changing the canonical SVG. Record evidence in validation.md. These checks do not establish backend or release readiness.
