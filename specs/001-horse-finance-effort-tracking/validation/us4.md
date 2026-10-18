# User Story 4: Record driving and activity

**Local acceptance: verified.** The HTTP-backed driving journey saves a rate, previews and records a trip, then reads back distance, rate provenance, amount, and horse allocation. The canonical fixture uses 10.125 km at 30 minor units/km: 303.75 rounds once, half away from zero, to 304 minor units. Changing the saved rate later does not rewrite the recorded receipt. The HTTP-backed activity journey stores a quantity-only task and verifies its activity projection with zero minutes. Activity remains outside financial reports. See [frontend-journeys.md](frontend-journeys.md), [backend-acceptance.md](backend-acceptance.md#backend-and-shared-api-work), and [implementation.md](implementation.md).

The final browser suite passed 21/21; frontend unit tests passed 68/68, and generated contracts passed 42/42 with no drift. Driving provenance and task payloads are covered by the all-variant event fixture and replay tests. The report journey confirms activity data is available without adding a financial amount.

Historical red-first evidence for T075–T076 and T081 was not retained, so those test-authoring tasks remain unchecked. Local functional acceptance is not Azure Files or WorkOS production evidence.
