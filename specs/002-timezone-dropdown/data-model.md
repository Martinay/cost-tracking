# Data model

The existing AccountSettings response and update body are unchanged.

- `currency`: existing currency code.
- `timeZone`: "Nonempty IANA identifier; preserve the exact selected or saved value."
- `settingsLocked`: "Time zone selection is disabled after financial activity."
- `streamVersion`: existing concurrency version.

Local draft transitions: loaded selection → changed selection → pending save → saved status or error with draft retained. An unconfigured account starts with an empty prompt and cannot save until a choice is made.
