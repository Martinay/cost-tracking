# Icon delivery contract

- `/horse-head.svg`: SVG viewBox 0 0 24 24, group id `horse-head`, currentColor outline, decorative in the shared Icon.
- `/favicon.svg`: white canonical profile on forest green, square viewBox.
- `/favicon.ico`: 16, 32, and 48 pixel PNG-backed entries.
- `/apple-touch-icon.png`: 180×180; `/icon-192.png`: 192×192; `/icon-512.png`: 512×512, opaque backgrounds.
- `/site.webmanifest`: Horse ledger name, relative icon URLs, PNG sizes and types, browser display mode.
- `frontend/index.html`: declares SVG and ICO favicons, touch icon, manifest, and theme color.
- Assets must be copied into production dist unchanged; manifest must be excluded from navigation fallback.
- Shared horse icon stays aria-hidden. Home and Horses labels remain supplied by AppShell translations.
