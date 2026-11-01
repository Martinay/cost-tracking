import { formatDate, formatMoney as money } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
import type { IncomeRuleInitialValue } from "./IncomeRuleForm";

export function IncomeRuleList({
  rules,
  currency,
  onRevise,
  onStop,
}: {
  rules: IncomeRuleInitialValue[];
  currency: string;
  onRevise(ruleId: string): void;
  onStop(ruleId: string): void;
}) {
  const { t, locale } = useI18n();
  if (rules.length === 0) return <p>{t("No recurring income rules.")}</p>;
  return (
    <ul aria-label={t("Recurring income rules")}>
      {rules.map((rule) => (
        <li key={rule.ruleId}>
          <h3>{rule.defaults.source}</h3>
          <p>
            {t(rule.schedule.cadence)} ·{" "}
            {money(rule.defaults.amountMinor, currency, locale)} {t("· starts")}{" "}
            {formatDate(rule.startDate, locale)}
            {rule.lastDate
              ? t(" · inclusive through {value0}", {
                  value0: formatDate(rule.lastDate, locale),
                })
              : t(" · no end date")}
          </p>
          <ul
            aria-label={t("Revisions for {value0}", {
              value0: rule.defaults.source,
            })}
          >
            {rule.revisions.map((revision) => (
              <li key={revision.effectiveFrom}>
                {t("Effective ")}
                {formatDate(revision.effectiveFrom, locale)} ·{" "}
                {t(revision.schedule.cadence)} ·{" "}
                {money(revision.defaults.amountMinor, currency, locale)}{" "}
                {t("from")} {revision.defaults.source}
              </li>
            ))}
          </ul>
          {!rule.lastDate && (
            <div>
              <button type="button" onClick={() => onRevise(rule.ruleId)}>
                {t("Revise income rule")}
              </button>
              <button type="button" onClick={() => onStop(rule.ruleId)}>
                {t("Stop income rule")}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
