# Research: Settings time zone dropdown

## Option source

**Decision**: Use native Intl.supportedValuesOf("timeZone") plus UTC and the current saved value, deduplicate and alphabetically sort.
**Rationale**: The pinned Node runtime returns 418 zones. UTC and accepted aliases can be absent; preserving the exact saved value prevents silent changes. Installed TypeScript supports this ES2022 API. No dependency or network request is required.
**Alternatives considered**: A hardcoded short list excludes many owners; a bundled database adds maintenance; a custom searchable widget adds unnecessary interaction complexity.

## Interaction and persistence

**Decision**: Native required select with an empty disabled prompt, persistent label, helper description, existing disabled rules and mutation.
**Rationale**: Reuses currency control styling and native keyboard/touch behavior. Backend validation remains authoritative.
**Alternatives considered**: Datalist still permits free text; normalizing saved aliases could alter existing data.

## Validation

**Decision**: Observe failing regression tests before changing production code; then run build, lint, affected component tests, and browser acceptance tests at desktop and 375px.
**Rationale**: Meets repository constitution and local UI validation requirements. These checks do not establish release readiness.
