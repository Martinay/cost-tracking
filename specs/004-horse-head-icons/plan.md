# Implementation Plan: Horse-head icons

**Branch**: `codex/horse-head-icons` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

## Summary

Use one local SVG horse-head outline for the shared horse icon. Generate forest-green favicon, touch, and app assets from that geometry, and declare them in the document head and web manifest.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19.3, Node 24.19.0 / npm 11.17.0.
**Primary Dependencies**: Existing Vite, Vitest, Testing Library, Playwright only.
**Storage**: Static assets; no account data changes.
**Testing**: Asset/metadata contract tests, existing component suite, production preview inspection.
**Target Platform**: Modern desktop/mobile browsers with ICO fallback.
**Project Type**: Existing web frontend.
**Performance Goals**: Small local SVG; no network service dependency.
**Constraints**: Existing design tokens, translated accessible labels, no financial/auth/cache changes.
**Scale/Scope**: Brand and Horses icon plus SVG/ICO favicon, 180px touch and 192/512px app icons.

## Constitution Check

Pre-design and post-design: PASS. Single SVG geometry; no new dependencies or domain changes. Asset contract test fails before implementation. Browser inspection verifies user recognition and navigation. Existing icon accessibility is preserved. Generation uses existing Playwright at an explicit filesystem boundary.

## Project Structure

```text
specs/004-horse-head-icons/{spec,plan,research,data-model,quickstart,tasks}.md
specs/004-horse-head-icons/contracts/icons.md
frontend/public/{horse-head.svg,favicon.svg,favicon.ico,apple-touch-icon.png,icon-192.png,icon-512.png,site.webmanifest}
frontend/src/components/Icon.tsx
frontend/index.html
frontend/tests/components/BrandIcons.test.tsx
scripts/generate-icons.mjs
docs/design-system.md
```

**Structure Decision**: Extend existing shared Icon and static asset delivery; preserve AppShell dimensions and all functional icons.
