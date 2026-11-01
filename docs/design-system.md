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

### Page headings

Use `PageHeading` with an existing heading ID, a concise title, and one sentence describing the page. Optional children provide page actions. Preserve one meaningful h1 per page. Loading and error screens retain their page heading.

### Cards and lists

Use sections with accessible headings for coherent groups. Settings cards pair a numbered marker with a title and a short description; numbering is specific to this ordered setup page. Use `card-heading`, `settings-card`, `field-grid`, `field`, `field-hint`, and `form-footer` for the settings pattern. Avoid nesting cards without a meaningful grouping.

Horse collections use responsive cards. Activity, recurring rules, and ledger entries use divided lists with clear descriptions, dates, and actions. Supporting allocations sit beneath their parent entry. Status badges always include visible text.

### Forms and actions

Every input needs a persistent, associated label. Fields are at least 43px tall and normally bounded to 440px, with full available width on mobile. Keep helper text adjacent to its field. Checkboxes and radios retain their native semantics and use the brand accent.

Primary actions are forest green with white text; secondary actions are white with a subtle border. Use explicit button types, descriptive verbs, visible disabled states, and pending text during submission. Settings actions sit in a right-aligned footer separated by a rule. Preserve controlled drafts, confirmation previews, and existing financial safety checks when changing presentation.

Expense categories use the shared `ExpenseCategorySelect` in one-off expenses, recurring rules and revisions, and occurrence edits. Use a required native dropdown with an explicit “Choose a category” prompt and the seven supported non-driving choices. Preserve the existing selection and preview invalidation callback. Associate adjacent help explaining the separate mileage flow for driving costs. Fixed category choices must not use free-text inputs or datalists.

### Data and feedback

Tables have captions, scoped column/row headers, subtle horizontal rules, aligned numeric values, and restrained row hover. Keep financial units in headings or values. Preserve the existing accessible `ReportTableRegion` wrapper.

Empty states explain what is absent and what will appear later. Use the `empty-state` pattern for larger empty regions. Loading messages use `role="status"`; success updates remain polite; actionable errors use `role="alert"` with adjacent retry actions where available. Never erase a form on failed submission.

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

### Quick task shortcuts
Task entry groups horse/date and activity type/minutes with `field-grid`. Quantity is historical data, not a task-entry control. Quick tasks use wrapping, named buttons with a second line for duration and `aria-pressed` selection. Selection fills a draft; the explicit Save task action records it. Manage mode reveals Edit/Delete actions, and the shared Modal edits name/type/default minutes. Custom labels persist in task notes; reporting keeps canonical types. Clearly disclose account-scoped browser-only preferences. Preserve drafts and show alerts on storage failures; do not silently replace malformed libraries. At mobile widths, names wrap and no shortcut controls cause page overflow.
