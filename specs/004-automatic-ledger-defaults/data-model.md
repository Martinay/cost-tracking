# Data model

AccountProjection: absent currency defaults to "EUR"; absent timeZone defaults to "UTC". Explicit historical settings remain unchanged. StreamVersion remains event count, including zero for an empty account. DrivingRateMinorPerKm remains optional and existing settings lock behavior remains.

New configuration request: currency MUST equal "EUR"; timeZone retains supported IANA validation for API compatibility. Historical AccountConfigured events retain the original supported-currency/IANA validation.

EventEnvelope.OccurredAt remains a UTC instant (offset zero). Financial dates remain YYYY-MM-DD calendar dates with no timezone conversion. No schema or event migration.
