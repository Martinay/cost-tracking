# Feature Contracts

- [events-v1.schema.json](events-v1.schema.json): canonical persisted event envelope and 17 event payload variants. JSON Schema draft 2020-12; runtime validation must enforce formats and [semantic constraints](../data-model.md).
- [auth.md](auth.md): WorkOS server-managed session lifecycle, JWT and browser security.
- [http-api.md](http-api.md): authenticated endpoints, input/output refinements, previews, versions, errors and paging.
- [ui.md](ui.md): primary user tasks, state/feedback/accessibility and acceptance checks.
- [storage.md](storage.md): command atomicity, verified lock, durability, replay and operational proof.

The event schema was extracted from the architecture and refined before implementation with commandHash, splitMode and safe-integer bounds. No persisted production data exists, so this is still schema version 1. Once events exist, changes require explicit compatibility/upcasting decisions and historical fixtures.

C# event records must validate against this schema. C# HTTP request/response records are the implementation source for generated OpenAPI and TypeScript transport types; contract tests enforce the endpoint behavior specified here. Do not hand-edit generated client types or duplicate monetary/schedule rules in the browser. Architecture diagrams and C# sketches explain the design but do not replace these contracts.
