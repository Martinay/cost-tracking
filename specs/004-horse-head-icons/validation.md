# Validation evidence

**Date**: 2026-11-01
**Scope**: Horse-head icon assets and their frontend integration.

- Node 24.19.0, npm 11.17.0 from the README-pinned local runtime.
- Red: three new icon delivery tests failed because the canonical reference, metadata, and raster assets were absent.
- Green: frontend suite passed 86/86 tests across 18 files, including all three icon tests.
- Production build (including TypeScript), ESLint, Prettier check, and git diff whitespace check passed.
- Generated assets using existing Playwright Chromium. No dependencies added.
- Inspected the production preview in Chromium at 1440×900 and 375×900. Both brand and Horses navigation render the canonical external SVG correctly; page scroll width equals viewport width.
- Home retains the accessible name “Horse ledger home”; home and Horses links accept keyboard focus. Decorative SVG remains aria-hidden. Existing authentication component tests pass.
- All seven declared/canonical resources returned HTTP 200 with the expected SVG, ICO, PNG, or manifest content type. No HTML fallback. PNG dimensions and ICO entries pass contract tests.
- Visually inspected favicon at 16, 20, 27, 48, and 180 pixels, plus the 192px raster app icon. Horse ears, muzzle, and neck remain recognizable.
- No browser page errors in the completed preview run. Preview used isolated empty-account response fixtures only; it does not establish backend acceptance.

Screenshots were inspected locally under `/private/tmp/horse-icons-{1440,375,preview}.png`; they are disposable review artifacts, not repository files.

## Limits

Local checks do not establish release readiness, real-device shortcut installation, Safari behavior, WorkOS staging, Azure SMB durability, target-region performance, usability-study acceptance, or billing gates. Existing release criteria remain governed by specs/001-horse-finance-effort-tracking. CI outcome is reported by the PR checks rather than recorded speculatively here.
