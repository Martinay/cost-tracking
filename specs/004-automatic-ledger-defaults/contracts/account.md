# Account contract

GET /api/v1/account on an empty authenticated stream returns currency EUR, timeZone UTC, streamVersion 0, settingsLocked false, drivingRateMinorPerKm null; ETag remains "0". No append occurs.

PUT /api/v1/account retains request/response shape, idempotency and If-Match semantics. New requests permit EUR only; supported IANA timezone values remain accepted for API compatibility, otherwise 422 invalid_account_settings with currency/timeZone field. Financially locked accounts still return 409 settings_locked. Exact accepted historic retries remain replayable through the command pipeline.

Settings UI has explanatory euro/browser-time text, driving-rate editor, and history; no currency/timezone selectors or Save settings action. Horses UI offers Add horse without a setup gate. History time elements retain machine-readable UTC dateTime and localized browser-time text. Date-only fields are unchanged.
