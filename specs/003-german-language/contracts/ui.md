# UI contract

- AppShell exposes an associated select label: Language / Sprache. Options remain English and Deutsch; values en/de. Works before authentication and after settings freeze.
- I18nProvider supplies language, locale, setLanguage and t(source, named values). Default context is English for isolated consumers. State changes preserve child identity and controlled drafts.
- Storage failures are handled only at the preference boundary. Document `lang` tracks the selected language and document title is localized.
- t returns localized app-owned messages with named interpolation, falling back to English source for missing messages. Arbitrary user data must not be translated.
- Presentational enum labels may be translated; their option values, comparisons, query keys, payloads and financial previews remain canonical.
- Known API codes are mapped to localized recovery messages for German; unknown messages/details remain readable original diagnostics. Authentication status messages are translated when rendered.
- Currency/date formatters receive the selected locale. Input values, minor-unit arithmetic, account currency/time zone and ownerToday remain unchanged.
