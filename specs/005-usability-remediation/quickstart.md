# Validation guide

Use README pinned Node 24.19.0 and .NET SDK 10.0.103. Add .local/toolchain/node-v24.19.0-darwin-arm64/bin to PATH. Follow ../001-horse-finance-effort-tracking/quickstart.md for isolated TestHost setup.

Run backend tests with `dotnet test backend/CostTracking.slnx`; frontend `npm test -- --run`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run contracts:check`, `npm run test:e2e`. Regenerate typed transport after API changes using repository generation scripts.

Exercise €60 ratio 2:1 → €40/€20; 24 km × €0.30 → €7.20; three consecutive tasks; reasoned correction moving a record between months and horses; €140 partial against €150 then €10 receipt; final €140 settlement remains closed. Confirm exact reports, event replay and owner isolation.

At 1440px, 680px and 390px inspect populated/error/empty states, keyboard navigation and editor focus/cancel, month browsing, visible net/totals, quantity-only work and same-subject draft restore. Verify English/German changes preserve input and previews. Use only isolated synthetic storage; never production credentials.

Retain original report/evidence. Local checks do not establish real hosted WorkOS behavior, target storage durability, human usability-study acceptance or release readiness. Record exact external logout settings and remaining verification separately.
