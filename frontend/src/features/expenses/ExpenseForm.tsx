import { formatDate, formatMoney as money } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
import { useEffect, useRef } from "react";
import { SplitFields } from "../finance/SplitFields";
import { useFinancialForm } from "../finance/useFinancialForm";

export function ExpenseForm() {
  const { t, locale } = useI18n();
  const form = useFinancialForm("Expense");
  const amountInput = useRef<HTMLInputElement>(null);
  const amountError = form.errorFor("amountMinor");
  useEffect(() => {
    if (amountError) amountInput.current?.focus();
  }, [amountError]);
  if (form.loading || !form.ready)
    return <p role="status">{t("Loading account and horses…")}</p>;
  return (
    <section aria-labelledby="expense-form-heading">
      <h2 id="expense-form-heading">{t("Record expense")}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          form.previewNow();
        }}
      >
        <label htmlFor="expense-date">{t("Expense date")}</label>
        <input
          id="expense-date"
          type="date"
          required
          value={form.date}
          onChange={(event) => form.setDate(event.currentTarget.value)}
        />
        {form.errorFor("expenseDate") && (
          <p role="alert">{t(form.errorFor("expenseDate"))}</p>
        )}
        <label htmlFor="expense-amount">{t("Amount")}</label>
        <input
          ref={amountInput}
          id="expense-amount"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          type="number"
          required
          value={form.amount}
          onChange={(event) => form.setAmount(event.currentTarget.value)}
        />
        {form.errorFor("amountMinor") && (
          <p role="alert">{t(form.errorFor("amountMinor"))}</p>
        )}
        <label htmlFor="expense-category">{t("Category")}</label>
        <select
          id="expense-category"
          required
          value={form.detail}
          onChange={(event) => form.setDetail(event.currentTarget.value)}
        >
          <option value="">{t("Choose a category")}</option>
          {[
            "Stabling",
            "Veterinary",
            "Farrier",
            "Feed",
            "Equipment",
            "Training",
            "Other",
          ].map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </select>
        {form.errorFor("category") && (
          <p role="alert">{t(form.errorFor("category"))}</p>
        )}
        <label htmlFor="expense-description">{t("Description")}</label>
        <input
          id="expense-description"
          maxLength={500}
          value={form.description}
          onChange={(event) => form.setDescription(event.currentTarget.value)}
        />
        <SplitFields
          horses={form.allHorses}
          value={form.split}
          onChange={form.setSplit}
        />
        {form.errorFor("split") && (
          <p role="alert">{t(form.errorFor("split"))}</p>
        )}
        <button type="submit" disabled={!form.canPreview}>
          {form.previewing ? t("Previewing…") : t("Preview expense")}
        </button>
      </form>
      {form.errorMessage && <p role="alert">{t(form.errorMessage)}</p>}
      {form.preview && (
        <section aria-label={t("Expense preview")}>
          <h3>{t("Preview")}</h3>
          <p>
            {money(
              form.preview.amountMinor,
              form.preview.currency ?? form.currency,
              locale,
            )}{" "}
            {t("on ")}
            {formatDate(form.preview.date, locale)}
          </p>
          <p>
            {t(form.preview.splitMode)} {t("allocation")}
          </p>
          <ul aria-label={t("Server calculated allocations")}>
            {form.preview.allocations.map((item) => (
              <li key={item.horseId}>
                {form.allHorses.find((horse) => horse.horseId === item.horseId)
                  ?.name ?? t("Horse")}
                :{" "}
                {money(
                  item.amountMinor,
                  form.preview!.currency ?? form.currency,
                  locale,
                )}
              </li>
            ))}
          </ul>
          <h4>{t("Monthly effect")}</h4>
          <ul aria-label={t("Monthly effect")}>
            {form.preview.monthlyEffect.map((effect) => (
              <li key={`${effect.month}-${effect.horseId}`}>
                {effect.month}:{" "}
                {form.allHorses.find(
                  (horse) => horse.horseId === effect.horseId,
                )?.name ?? t("Horse")}{" "}
                {t("expenses")}{" "}
                {money(
                  effect.expenseDeltaMinor,
                  form.preview!.currency ?? form.currency,
                  locale,
                )}
              </li>
            ))}
          </ul>
          <button type="button" disabled={!form.canSave} onClick={form.save}>
            {form.saving ? t("Saving…") : t("Save expense")}
          </button>
        </section>
      )}
      {form.notice && <p role="status">{t(form.notice)}</p>}
    </section>
  );
}
