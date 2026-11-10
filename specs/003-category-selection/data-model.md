# Data model
No persisted models change. Category remains an existing required string in expense, rule defaults, and changed occurrence payloads.

Allowed UI values: Stabling, Veterinary, Farrier, Feed, Equipment, Training, Other.
Empty string represents an unselected draft and is not a valid completed category. Driving requires the separate mileage flow. Existing supported selections are preserved exactly.
