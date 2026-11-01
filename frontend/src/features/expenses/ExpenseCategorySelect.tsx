const expenseCategories = [
  "Stabling",
  "Veterinary",
  "Farrier",
  "Feed",
  "Equipment",
  "Training",
  "Other",
] as const;

interface ExpenseCategorySelectProps {
  id: string;
  value: string;
  onChange(value: string): void;
}

export function ExpenseCategorySelect({
  id,
  value,
  onChange,
}: ExpenseCategorySelectProps) {
  return (
    <>
      <label htmlFor={id}>Category</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-describedby={`${id}-hint`}
        required
      >
        <option value="">Choose a category</option>
        {expenseCategories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="field-hint">
        Record driving costs separately using mileage.
      </p>
    </>
  );
}
