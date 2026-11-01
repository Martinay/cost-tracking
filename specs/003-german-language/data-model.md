# Data model

## InterfaceLanguage
- `language`: **exactly `en` or `de`**. Default `en`; invalid persisted data falls back to `en`.
- Locale derived as en-US or de-DE.
- Storage key: horse-ledger.language; preference contains no account, token or financial data.
- Transition: select supported value → update context/document language → attempt persistence. Storage access failure leaves the in-memory selection usable.

## InterfaceMessage
- English source text, German text, and optional named interpolation values.
- Unknown message falls back to its source. User-entered fields and historical summary data never pass through the catalogue.

No backend entity, event or HTTP schema changes.
