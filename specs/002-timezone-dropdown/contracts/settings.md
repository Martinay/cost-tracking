# Settings interaction contract

- Accessible name: `Time zone`; native combobox associated with `account-time-zone`.
- Options: sorted unique runtime IANA identifiers plus UTC and any nonempty saved identifier.
- Empty state: disabled `Select a time zone` option; required field and disabled Save settings until selected.
- Disabled state: existing settings lock or pending save.
- Help: existing dates and recurring schedules text linked through aria-describedby.
- Persistence: unchanged authenticated PUT /api/v1/account body `{ currency, timeZone }`, existing concurrency/idempotency handling and subject-scoped cache.
- Errors retain selection; success announces Account settings saved.
- No backend, auth, schema, financial, or recurring schedule logic changes.
