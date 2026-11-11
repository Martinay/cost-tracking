import {
  formatDate,
  formatMonth,
  formatMoney as money,
} from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
import { useEffect, useRef } from "react";
import { SplitFields } from "../finance/SplitFields";
import { useFinancialForm } from "../finance/useFinancialForm";

export function IncomeForm() {
  const { t, locale } = useI18n();
  const form = useFinancialForm("Income");
  const amountInput = useRef<HTMLInputElement>(null);
  const amountError = form.errorFor("amountMinor");
  useEffect(() => {
    if (amountError) amountInput.current?.focus();
  }, [amountError]);
  if (form.loading || !form.ready)
    return <p role="status">{t("Loading account and horses…")}</p>;
  return (
    <section aria-labelledby="income-form-heading">
      <h2 id="income-form-heading">{t("Record income")}</h2>
      <p>
        {t(
          "Choose a date, positive amount and at least one horse. Category or source is required; description is optional.",
        )}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          form.previewNow();
        }}
      >
        <label htmlFor="income-date">{t("Received date")}</label>
        <input
          id="income-date"
          type="date"
          required
          value={form.date}
          onChange={(event) => form.setDate(event.currentTarget.value)}
        />
        {form.errorFor("receivedDate") && (
          <p role="alert">{t(form.errorFor("receivedDate"))}</p>
        )}
        <label htmlFor="income-amount">{t("Amount")}</label>
        <input
          ref={amountInput}
          id="income-amount"
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
        <label htmlFor="income-source">{t("Source")}</label>
        <input
          id="income-source"
          maxLength={100}
          required
          value={form.detail}
          onChange={(event) => form.setDetail(event.currentTarget.value)}
        />
        {form.errorFor("source") && (
          <p role="alert">{t(form.errorFor("source"))}</p>
        )}
        <SplitFields
          horses={form.allHorses}
          value={form.split}
          onChange={form.setSplit}
        />
        {form.errorFor("split") && (
          <p role="alert">{t(form.errorFor("split"))}</p>
        )}
        <button type="submit" disabled={!form.canPreview}>
          {form.previewing ? t("Previewing…") : t("Preview income")}
        </button>
      </form>
      {form.errorMessage && !form.errorFor("split") && (
        <p role="alert">{t(form.errorMessage)}</p>
      )}
      {form.preview && (
        <section aria-label={t("Income preview")}>
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
              <li
                key={`${formatMonth(effect.month, locale)}-${effect.horseId}`}
              >
                {formatMonth(effect.month, locale)}:{" "}
                {form.allHorses.find(
                  (horse) => horse.horseId === effect.horseId,
                )?.name ?? t("Horse")}{" "}
                {t("income")}{" "}
                {money(
                  effect.incomeDeltaMinor,
                  form.preview!.currency ?? form.currency,
                  locale,
                )}
              </li>
            ))}
          </ul>
          <button type="button" disabled={!form.canSave} onClick={form.save}>
            {form.saving ? t("Saving…") : t("Save income")}
          </button>
        </section>
      )}
      {form.notice && <p role="status">{t(form.notice)}</p>}
    </section>
  );
}
