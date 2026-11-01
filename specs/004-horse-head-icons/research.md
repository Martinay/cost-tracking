# Research: Horse-head icons

- Existing brand and Horses navigation both use `Icon name="horses"`; update that one branch.
- Existing document head declares no icons. Static Web Apps already excludes SVG, PNG, and ICO from fallback; add manifest exclusion.
- Use a right-facing outline with two ears, elongated muzzle, jaw, and curved neck. Retain currentColor for workspace icons.
- Canonical geometry lives in `frontend/public/horse-head.svg`, referenced by an external SVG use element. Derived icons embed that geometry on #285843 with white strokes and generous padding.
- Generate raster assets with existing Playwright Chromium and an ICO container using standard Node Buffer operations. No image library or runtime dependency is needed.
- Keep a manifest for icon discovery only, without standalone display or offline claims.
