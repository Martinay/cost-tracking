import { useI18n } from "../../i18n/I18nProvider";

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
  const { t } = useI18n();
  return (
    <>
      <label htmlFor={id}>{t("Category")}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-describedby={`${id}-hint`}
        required
      >
        <option value="">{t("Choose a category")}</option>
        {expenseCategories.map((category) => (
          <option key={category} value={category}>
            {t(category)}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="field-hint">
        {t("Record driving costs separately using mileage.")}
      </p>
    </>
  );
}
