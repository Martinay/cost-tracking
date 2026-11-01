# Validation guide

Use Node 24.19.0 from README. Install locked frontend dependencies with npm --prefix frontend ci. Run npm --prefix frontend run test -- --run, npm --prefix frontend run lint, and npm --prefix frontend run build. Run npm --prefix frontend run test:e2e for the HTTP-backed browser suite when the .NET test toolchain is available.

1. Open the signed-out interface. Select Deutsch by keyboard: navigation/welcome/status text and document lang become German. Reload and verify persistence. Select English and reload again.
2. With a synthetic authenticated account, visit horses, expenses, income, approvals, tasks, reports and settings in German; inspect headings, labels, empty/loading/error states and dialogs.
3. Start a form draft and preview, switch languages, and verify its values and allocations remain unchanged. Submit a task with German labels; verify canonical task type in the command and German success feedback.
4. Verify German currency formatting with an unchanged amount/currency and German dates with unchanged ISO inputs.
5. Repeat selector/navigation at 375px and 1440px; check keyboard access, visible focus, wrapping and no document overflow.
6. Invalid preference and denied storage must keep English fallback and allow session-local language changes.

Record observed results in validation.md. Local checks do not establish release readiness; retain all existing external gates in specs/001-horse-finance-effort-tracking/.
