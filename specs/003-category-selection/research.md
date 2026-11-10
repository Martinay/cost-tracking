# Research

## Decision: native select with explicit prompt
Rationale: seven fixed values need no search, filtering, or custom popup. A native select exposes valid choices and supplies keyboard/touch behavior and a dropdown affordance.
Alternatives considered: datalist leaves invalid free text possible and varies by browser; custom combobox adds unnecessary focus and popup behavior; radio cards consume excessive space in already lengthy financial forms.

## Decision: share the picker across all category inputs
Rationale: three existing call sites, including occurrence edits, require the exact same values. Keep callbacks responsible for preview invalidation.
Evidence: `backend/src/CostTracking.Api/Domain/RuleRevisions.cs` and `Features/Expenses/FinancialEndpointSupport.cs` accept the same seven ordinary categories. Driving requires dedicated mileage data. Custom category text is not supported by the server.

## Decision: explain driving adjacent to the control
Rationale: users see why Driving is absent without discovering it through a failed preview. Income source is free text by design and is not an expense category.
