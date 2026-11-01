# Implementation Plan: Multilanguage support with German

**Branch**: `codex/add-german-language` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

## Summary

Add a React language provider with a centrally maintained English/German message catalogue, browser-local preference and a shared language selector in AppShell. Translate at rendering boundaries so drafts and canonical API values never change. Use the selected locale with existing Intl formatting. No new dependency or backend change.

## Technical Context

**Language/Version**: TypeScript 5.9.3, React 19.3.0, Node 24.19.0.
**Primary Dependencies**: Existing React, TanStack Query, Vite; platform Intl and localStorage.
**Storage**: Browser-local `horse-ledger.language`, values `en` or `de` only.
**Testing**: Vitest/Testing Library and Playwright browser validation.
**Target Platform**: Modern desktop/mobile browsers.
**Project Type**: Web application.
**Performance Goals**: Synchronous language change with no network requests.
**Constraints**: No draft remount, data translation, financial changes, cache invalidation or new authentication surface.
**Scale/Scope**: All existing routes, shared components, forms, dialogs and reports; two languages.

## Constitution Check

Pre-research: PASS. React context and platform formatting are sufficient; no new dependencies or domain duplication. Explicit context keeps language traceable. Specification precedes tests; failing behavior tests precede production implementation.
Post-design: PASS. Translation stays at presentation boundaries, canonical values stay intact, and meaningful language/form/format tests plus running UI checks validate the primary task. Existing release gates remain separate.

## Project Structure

```text
specs/003-german-language/{spec,plan,research,data-model,quickstart,tasks}.md
specs/003-german-language/contracts/ui.md
frontend/src/i18n/{I18nProvider.tsx,messages.ts}
frontend/src/components/LanguageSelector.tsx
frontend/src/{main.tsx,components,auth,routes,features,styles.css}
frontend/tests/components/I18n.test.tsx
frontend/tests/e2e/language.spec.ts
```

**Structure Decision**: Keep the existing web application structure and add one small presentation-level module. Existing English strings are catalogue keys to make fallback readable. Components use context; helpers receive explicit language/locale. Translation does not modify API/client state.
