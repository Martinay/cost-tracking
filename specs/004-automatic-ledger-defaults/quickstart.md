# Validation guide

Use README.md pinned Node 24.19.0 and .NET SDK. Run dotnet test backend/tests/CostTracking.Tests, then in frontend run npm test -- --run, npm run build, npm run lint. Use npm run test:e2e -- settings.spec.ts private-ledger.spec.ts driving.spec.ts language.spec.ts for affected journeys.

Fresh-account checks: GET account twice returns EUR/UTC/version 0; add a horse, preview/save income and expense without a configuration request; reports use EUR. Reject new non-EUR configuration, retaining old replay tests.

At desktop and 375px inspect settings: no preference selectors, explanation visible, editable driving rate, history with browser-local timestamps. Run in Berlin and New York timezone contexts, compare a midnight-boundary UTC event to Intl local display, and ensure date-only values preserve their day. Repeat in German. Save failures should retain retry behavior.

Record exact results and unavailable checks in validation.md. Local checks do not establish release readiness; existing feature-001 deployment, identity, durability and performance gates apply.
