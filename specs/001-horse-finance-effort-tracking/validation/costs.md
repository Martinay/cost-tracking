# Regional cost estimate and usage record

## Status: NOT EXECUTED

No Azure region, subscription, storage account, domain, WorkOS plan, or deployed usage period was supplied. No cloud resources were provisioned and no bill, meter export, or regional estimate was measured. This document is a collection worksheet, not a price quote or evidence that the under-$5/month target is met.

## Required inputs

Record the estimate date, currency, billing scope, selected region, and source for each price. Confirm current product eligibility and free grants in the target subscription; do not assume grants transfer to every account or month.

| Cost area | Required observed/configured inputs | Evidence to attach |
|---|---|---|
| Container Apps | Region, CPU/memory, active replica seconds, request/scale behavior, min/max replicas, cold-start frequency | Deployed configuration export and a representative usage/meter period |
| Container registry | Registry SKU, image count/retention, stored GB, pulls/egress | Registry configuration and usage export |
| Azure Files | Standard account/share SKU and billing model, region, redundancy, capacity, transaction mix, growth/headroom | Account/share configuration and storage meter export; operator confirms Standard SKU because Bicep only references the existing account/share |
| Independent backup | Separate failure domain, capacity, 30 daily generations, write/read transactions, retention enforcement, restore traffic | Backup service configuration, retention proof, and restore drill record |
| Logs and alerts | Ingested GB/day, 30-day retention, 1 GB/day cap, query/metric alert settings and action delivery | Workspace usage export and alert delivery test |
| Network | Region, egress volume, cross-region transfer, DNS/query volume if charged | Application usage estimate and meter export |
| Identity | WorkOS plan/entitlements, monthly active-user or connection allowances, overage basis | Current plan/entitlement evidence from the configured tenant |
| Domain/DNS | Existing versus new domain, annual renewal, DNS provider/zone/query charges | Registrar/provider invoices and renewal dates |

## Calculation and validation procedure

1. Freeze an explicit workload assumption: accounts, horses, accepted changes per month, average event bytes, retention, reads/reports, concurrent users, backup generations, and expected egress. Use measured production-like synthetic workload for usage meters; label assumptions separately from observations.
2. Price each configured SKU, region, capacity, transaction, retention, and network input with the provider's current calculator or subscription billing export on the estimate date. Include independent backups, logs, registry, WorkOS entitlements, and domain/DNS. Record discounts and grants only when the target subscription proves eligibility.
3. Sum monthly recurring charges and allocate annual domain charges monthly. Show low/base/high usage scenarios and identify which quantities are measured versus assumed. Compare each scenario to the under-$5 target.
4. Configure a spending alert below the accepted monthly cap and trigger a harmless test notification. A forecast alert does not cap spend; document the operator response and capacity/backup safeguards.
5. After a representative billing period, compare estimate to actual meter/export data, investigate variance, and update the acceptance decision. The owner must explicitly approve any budget exception before deployment.

## Acceptance record template

| Estimate date / region | Scope and scenario | Estimated monthly total | Measured monthly total | Usage window | Alert threshold / delivery test | Under $5 (yes/no) | Owner decision |
|---|---|---:|---:|---|---|---|---|
| NOT RECORDED | NOT RECORDED | — | — | — | NOT TESTED | NOT VERIFIED | Pending evidence |

The template in [infra/README.md](../../../infra/README.md) specifies zero minimum/one maximum API replicas, Static Web Apps Free, 30-day log retention, and an operator-supplied Azure Files account. Those are configuration intentions, not measured prices or eligibility claims. The designated account/share must be verified as Azure Files Standard; the existing-resource Bicep template cannot enforce SKU. Azure Files capacity metrics can lag and do not replace an explicit capacity-headroom policy.
