# Remediation contracts

All commands retain authenticated subject ownership, If-Match, Idempotency-Key and existing API error protocol. Foreign and missing IDs use the same not-found outcome. Additive fields/variants preserve replay of existing events.

- Financial preview kinds ExpenseCorrection/IncomeCorrection identify recordId and validate full replacement values; include old negative and new positive monthly effects.
- POST expenses/{id}/corrections and income/{id}/corrections accept replacement values plus required reason. Response has logical ID and new streamVersion. Driving corrections retain exact distance/rate provenance or use a fresh driving calculation.
- POST tasks/{id}/corrections accepts replacement task plus reason and returns taskId/streamVersion.
- POST income-rules/{id}/occurrences/{date}/receipts accepts actual receipt values, uses authoritative preview and returns receiptId/streamVersion. Partial receipts are additive; legacy final decisions stay final.
- Decision-history read model identifies expected, cumulative actual, outstanding/waived amount, horses, date, outcome and original decision. No destructive undo is introduced.
- Existing monthly ledger from/to and horseId query contracts drive month browsing and report links.
- Ratio input accepts positive integer ratios and decimal percentage shares with up to six decimal places; normalization sums to 1,000,000 deterministically; server retains validation.
- Trip/default rate inputs use currency major units/km, transport stays rateMinorPerKm.
- Retired is eligible for new care entries; Sold remains ineligible. Historic unchanged-target exemptions remain intact.

UI: one entry workflow open per page, explicit cancel, initial focus, unique labels, previews invalidated after any field change. Native month/date inputs retain ISO values. Display dates use month names. Tables keep named keyboard scroll regions and visible scroll cues. English/German copy uses existing i18n rendering.

Upcoming schedule metadata is server-calculated strictly after the owner day across queued revisions and inclusive stops. It is a scheduled-date hint, not a prediction of unpaid balances. Driving correction amounts are calculated from distance/rate on the server; client amount hints never override that calculation.
