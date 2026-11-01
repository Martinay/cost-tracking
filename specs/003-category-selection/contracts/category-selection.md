# Category selection UI contract
`ExpenseCategorySelect` accepts `id: string`, `value: string`, and `onChange(value: string): void`.
It renders an associated Category label, required native select, empty Choose a category prompt, and seven backend-supported non-driving options. It associates adjacent driving guidance using aria-describedby. Callers retain their existing error rendering and preview invalidation callbacks. No API changes.
