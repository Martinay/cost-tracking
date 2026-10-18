import { useEffect, useRef } from "react";
import { SplitFields } from "../finance/SplitFields";
import { useFinancialForm } from "../finance/useFinancialForm";

export function ExpenseForm() {
  const form = useFinancialForm("Expense");
  const amountInput = useRef<HTMLInputElement>(null);
  const amountError = form.errorFor("amountMinor");
  useEffect(() => {
    if (amountError) amountInput.current?.focus();
  }, [amountError]);
  if (form.loading || !form.ready)
    return <p role="status">Loading account and horses…</p>;
  return (
    <section aria-labelledby="expense-form-heading">
      <h2 id="expense-form-heading">Record expense</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          form.previewNow();
        }}
      >
        <label htmlFor="expense-date">Expense date</label>
        <input
          id="expense-date"
          type="date"
          required
          value={form.date}
          onChange={(event) => form.setDate(event.currentTarget.value)}
        />
        {form.errorFor("expenseDate") && (
          <p role="alert">{form.errorFor("expenseDate")}</p>
        )}
        <label htmlFor="expense-amount">Amount</label>
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
          <p role="alert">{form.errorFor("amountMinor")}</p>
        )}
        <label htmlFor="expense-category">Category</label>
        <select
          id="expense-category"
          required
          value={form.detail}
          onChange={(event) => form.setDetail(event.currentTarget.value)}
        >
          <option value="">Choose a category</option>
          {[
            "Stabling",
            "Veterinary",
            "Farrier",
            "Feed",
            "Equipment",
            "Training",
            "Other",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        {form.errorFor("category") && (
          <p role="alert">{form.errorFor("category")}</p>
        )}
        <label htmlFor="expense-description">Description</label>
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
        {form.errorFor("split") && <p role="alert">{form.errorFor("split")}</p>}
        <button type="submit" disabled={!form.canPreview}>
          {form.previewing ? "Previewing…" : "Preview expense"}
        </button>
      </form>
      {form.errorMessage && <p role="alert">{form.errorMessage}</p>}
      {form.preview && (
        <section aria-label="Expense preview">
          <h3>Preview</h3>
          <p>
            {money(
              form.preview.amountMinor,
              form.preview.currency ?? form.currency,
            )}{" "}
            on {form.preview.date}
          </p>
          <p>{form.preview.splitMode} allocation</p>
          <ul aria-label="Server calculated allocations">
            {form.preview.allocations.map((item) => (
              <li key={item.horseId}>
                {form.allHorses.find((horse) => horse.horseId === item.horseId)
                  ?.name ?? "Horse"}
                :{" "}
                {money(
                  item.amountMinor,
                  form.preview!.currency ?? form.currency,
                )}
              </li>
            ))}
          </ul>
          <h4>Monthly effect</h4>
          <ul aria-label="Monthly effect">
            {form.preview.monthlyEffect.map((effect) => (
              <li key={`${effect.month}-${effect.horseId}`}>
                {effect.month}:{" "}
                {form.allHorses.find(
                  (horse) => horse.horseId === effect.horseId,
                )?.name ?? "Horse"}{" "}
                expenses{" "}
                {money(
                  effect.expenseDeltaMinor,
                  form.preview!.currency ?? form.currency,
                )}
              </li>
            ))}
          </ul>
          <button type="button" disabled={!form.canSave} onClick={form.save}>
            {form.saving ? "Saving…" : "Save expense"}
          </button>
        </section>
      )}
      {form.notice && <p role="status">{form.notice}</p>}
    </section>
  );
}
function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}
