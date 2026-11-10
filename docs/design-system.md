# Horse ledger design system

Horse ledger should feel like a calm, well-kept stable office: practical, warm, and easy to navigate. This is the canonical guide for all frontend work. The implementation lives in `frontend/src/styles.css` and shared components in `frontend/src/components/`.

## Principles

- Give every screen a clear heading, short explanation, and an obvious next action.
- Group related information into white cards on a warm neutral canvas. Use whitespace and type to establish hierarchy, rather than decoration.
- Keep financial information precise. Preserve currency, units, effective dates, previews, lock explanations, validation, and server-calculated allocations.
- Show only real account data. Never fill reports, counts, or activity with invented examples.
- Use restrained equestrian character: forest green, natural surfaces, and occasional serif accents. Avoid stock imagery, gradients, oversized marketing text, or elaborate animation in the workspace.

## Foundations

The CSS custom properties in `:root` are the source of truth. Reuse them instead of introducing alternate colors.

| Token | Value | Purpose |
| --- | --- | --- |
| `--canvas` | `#f6f7f4` | Page background |
| `--surface` | `#ffffff` | Cards and fields |
| `--surface-subtle` | `#f8faf7` | Secondary surfaces and table headers |
| `--ink` | `#243c32` | Headings and body emphasis |
| `--muted` | `#617067` | Descriptions and supporting text |
| `--brand` | `#285843` | Primary actions and navigation |
| `--brand-hover` | `#1d4433` | Primary hover |
| `--brand-tint` | `#eaf1e9` | Selected navigation and status badges |
| `--border` | `#dce3da` | Subtle structural boundaries |
| `--danger` | `#a33336` | Error text |
| `--radius` | `12px` | Cards |
| `--shadow` | Subtle 2px shadow | Quiet surface elevation |

Focus uses a 3px `#789967` outline with a 3px offset. Error surfaces use `#fff5f4` with a `#e7bfc1` border. Do not communicate state through color alone.

Use the local system sans-serif stack; no remote font dependency. Body is 14px with 1.6 line height. Page titles scale from 27px to 36px with restrained negative tracking. Section titles are 16px/600; labels and controls are 12px; descriptions are 12–13px. Small uppercase eyebrow labels are 9–10px with generous tracking. Georgia is reserved for horse names and occasional editorial notes. Tables use tabular numerals.

Use a spacing scale of 4, 8, 12, 16, 20, 24, 32, 40, 48, and 64px. Desktop cards have approximately 24–28px padding; mobile cards use 20px. Controls have 7px corners and cards 12px corners. Use a 1px border and minimal shadow; modals are the only strongly elevated surface.

## Layout and navigation

`AppShell` owns the sidebar, breadcrumb bar, skip link, account control, and main landmark. The sidebar is 244px on wide screens and 210px on narrower desktop screens. Main content has 48px horizontal padding, falling to 28px and then 20px. Content is centered and bounded on large displays.

Use semantic navigation anchors with `aria-current="page"`, including horse detail routes. Use the shared `Icon` component for consistent 20px outline icons. Icons supplement text and are hidden from assistive technology. Avoid raw account identifiers in the main workspace.

Below 700px, navigation becomes a horizontally scrollable row above content; keep every destination accessible. Main content and forms stack into a single column. Settings use a supporting note alongside the primary cards when space permits, and stack below 1180px. Tables scroll inside their named, focusable regions rather than causing page overflow.

## Components and patterns

### Horse-head identity

The brand and Horses navigation use the same right-facing horse-head outline, with upright ears, a long muzzle, and a curved neck. `frontend/public/horse-head.svg` is the canonical geometry; the shared `Icon` references its `horse-head` group and inherits the surrounding text color. Keep the mark decorative alongside accessible text labels.

Browser and shortcut icons use the same white outline on the `--brand` forest green. The SVG favicon has rounded corners; raster icons have a solid square background so devices can apply their own masks. Keep generous padding and check legibility at 16px. After editing the canonical SVG, run `node scripts/generate-icons.mjs` with the pinned Node runtime and installed Playwright Chromium to regenerate the SVG/ICO favicon and 180/192/512px PNG assets. The document head and `site.webmanifest` declare these local files; the manifest does not add an offline or standalone app flow.

### Page headings

Use `PageHeading` with an existing heading ID, a concise title, and one sentence describing the page. Optional children provide page actions. Preserve one meaningful h1 per page. Loading and error screens retain their page heading.

### Cards and lists

Use sections with accessible headings for coherent groups. Settings cards pair a numbered marker with a title and a short description; numbering is specific to the settings page. Use `card-heading`, `settings-card`, `field-grid`, `field`, `field-hint`, and `form-footer` for the settings pattern. Avoid nesting cards without a meaningful grouping.

Horse collections use responsive cards. Activity, recurring rules, and ledger entries use divided lists with clear descriptions, dates, and actions. Supporting allocations sit beneath their parent entry. Status badges always include visible text.

Horse cards extend their single native View link across the whole card with a positioned pseudo-element. Keep one translated accessible link name and one tab stop per card, with a brand border on hover and the standard focus outline around the card. Preserve native link actions and encoded destinations. Do not place additional interactive controls beneath the stretched link; revisit the pattern if cards gain other actions.

### Forms and actions

Every input needs a persistent, associated label. Fields are at least 43px tall and normally bounded to 440px, with full available width on mobile. Keep helper text adjacent to its field. Checkboxes and radios retain their native semantics and use the brand accent.

Primary actions are forest green with white text; secondary actions are white with a subtle border. Use explicit button types, descriptive verbs, visible disabled states, and pending text during submission. Settings actions sit in a right-aligned footer separated by a rule. Preserve controlled drafts, confirmation previews, and existing financial safety checks when changing presentation.

Expense categories use the shared `ExpenseCategorySelect` in one-off expenses, recurring rules and revisions, and occurrence edits. Use a required native dropdown with an explicit “Choose a category” prompt and the seven supported non-driving choices. Preserve the existing selection and preview invalidation callback. Associate adjacent help explaining the separate mileage flow for driving costs. Fixed category choices must not use free-text inputs or datalists.

### Data and feedback

Tables have captions, scoped column/row headers, subtle horizontal rules, aligned numeric values, and restrained row hover. Keep financial units in headings or values. Preserve the existing accessible `ReportTableRegion` wrapper.

Empty states explain what is absent and what will appear later. Use the `empty-state` pattern for larger empty regions. Loading messages use `role="status"`; success updates remain polite; actionable errors use `role="alert"` with adjacent retry actions where available. Never erase a form on failed submission. During a transient session check failure, keep the subject's form mounted and hidden while showing the session recovery controls outside that hidden content. A successful retry restores the draft; terminal sign-out clears private content.

Use the shared `Modal` for new dialogs (initial focus, focus containment, Escape, scroll lock, and focus restoration). Dialogs use an accessible name, modal semantics, a bounded width, a scrollable interior, and a dimmed background. They must move focus inside, keep keyboard focus contained, support appropriate dismissal, and restore focus to the trigger. Do not turn inline editors into visual modals without implementing these behaviors.

## Accessibility and responsive requirements

- Keep labels, landmarks, heading order, status announcements, and accessible names intact.
- Maintain readable contrast; do not reduce text opacity to create hierarchy.
- Keep keyboard focus visible and provide the skip-to-content link.
- Use at least 40px action heights and comfortable space between controls.
- Verify 375px mobile and desktop widths. Long names and identifiers must wrap; only navigation and data tables may scroll horizontally.
- Respect `prefers-reduced-motion`. Do not require motion to understand state.
- Print styles remove workspace navigation and controls to prioritize report content.

## Change and validation workflow

For any frontend change, read this guide first. Extend shared components and tokens before adding local variants. Update this document whenever a deliberate new reusable pattern is introduced, and keep its references in `AGENTS.md` and `README.md` current.

Run frontend typecheck/build, lint, and relevant component tests. For broad visual changes, inspect the running app at desktop and mobile sizes with representative populated, empty, loading, and error states. Check navigation, settings saves, form previews, and report overflow. Record any unavailable checks honestly; a visual refresh does not establish backend or release readiness.

## Interface languages

English and German share the same components and tokens. Style components with stable classes (for example, `horse-grid`), never translated accessible-label text. `I18nProvider` owns the browser-local interface preference; `useI18n` supplies translation, locale and error presentation. Translate app-owned copy at render time, including accessible names, canonical enum display labels, validation and feedback. Use complete messages with named interpolation when word order may vary. Keep English source text as the readable fallback and maintain German equivalents in `frontend/src/i18n/messages.ts`.

`LanguageSelector` uses the persistent label Language / Sprache with English and Deutsch options. Keep it available in the sidebar before and after sign-in, regardless of financial settings locks, and inside shared dialogs so drafts and server previews survive a language change. On mobile, sidebar account controls occupy a wrapping row below navigation; long German text must not overlap the brand or cause page overflow. Dialog language controls follow the form and participate in focus containment.

Use the selected locale for currency and date presentation through `frontend/src/i18n/format.ts`; preserve canonical minor amounts, ISO inputs, account currency/time zone and owner dates. Preserve user-entered names, descriptions, categories, sources, notes and units, plus stored server history summaries. Translate known API recovery messages while retaining unknown diagnostics. Language changes update the document language and title without remounting content, resetting forms or invalidating subject-scoped caches.

## Automatic ledger defaults

Fresh accounts use EUR and UTC automatically. Show explanatory text in the existing ledger preferences card, with no editable currency/timezone selectors or save action. Keep driving-rate editing and history accessible, and offer Add horse without a setup gate. Display history instants using the browser timezone and selected interface locale; preserve date-only ledger days. Explicit historic financial settings retain their original meaning.
