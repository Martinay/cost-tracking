# Research

- Decision: Default absent configuration to EUR/UTC in AccountProjection. Rationale: all finance endpoints share it; no event append or stream-version race. Alternative: auto-configure on signin introduces writes and concurrency concerns.
- Decision: Enforce EUR on new PUT commands after the existing locked-settings guard, leaving AccountSettings historical validation broad. Rationale: serializer uses that validator for legacy replay. Alternative: narrowing it would break historic USD/Berlin streams.
- Decision: Retain supported IANA values on the legacy configuration API for compatibility; the UI never asks for a timezone and new accounts use UTC. This does not affect UTC timestamp storage.
- Decision: Preserve explicit historic configuration. Rationale: relabeling old money as euro is financially incorrect; conversion/migration is outside scope.
- Decision: Keep browser-local toLocaleString(locale) history rendering and UTC date-only formatDate. Rationale: instants change local display while calendar dates must not shift. Alternative: converting all date-only fields into instants corrupts financial days.
- Decision: Replace editable preferences with explanatory text and preserve driving-rate/history sections. No new UI pattern or dependency is needed.

Repository research performed by a dedicated read-only research agent as required by the planning skill. No unresolved technical questions.
