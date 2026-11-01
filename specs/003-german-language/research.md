# Research

## Language state
Decision: Use React context, default English, explicit per-browser storage of en/de.
Rationale: Existing React is enough for immediate updates without remounting drafts. Independent of account finance locks and authentication.
Alternatives considered: New internationalization dependency (unnecessary for two catalogues); account persistence (requires unrelated API/event changes); automatic browser detection (changes existing default).

## Messages and data
Decision: Catalogue app-owned messages and named interpolation; translate canonical display enums separately from their submitted values. Unknown text falls back unchanged. Known API codes receive localized recovery text at display boundaries.
Rationale: Preserve user content, error diagnostics and canonical contracts. No mutation of server state or globally patched rendering.
Alternatives considered: DOM text replacement (unsafe for user data and accessibility); translating payloads (violates domain contracts).

## Formatting
Decision: Pass selected en-US/de-DE locale to existing Intl currency/date presentation; retain current minor-unit and owner-date rules.
Rationale: Language must not alter currency precision or financial rules. Existing implementation has several formatting helpers, all require selected locale.
Alternatives considered: Locale-dependent input parsing (out of scope; ISO date and numeric input contracts remain).

## Evidence and unknowns
Repository sources inspected: README, design system, constitution, main/AppShell/auth, route and form components, report formatters, test setup and existing acceptance guide. All technical choices resolved using existing APIs; no external dependency research required.
