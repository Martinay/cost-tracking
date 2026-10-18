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
  if (rules.length === 0) return <p>No recurring income rules.</p>;
  return (
    <ul aria-label="Recurring income rules">
      {rules.map((rule) => (
        <li key={rule.ruleId}>
          <h3>{rule.defaults.source}</h3>
          <p>
            {rule.schedule.cadence} ·{" "}
            {money(rule.defaults.amountMinor, currency)} · starts{" "}
            {rule.startDate}
            {rule.lastDate
              ? ` · inclusive through ${rule.lastDate}`
              : " · no end date"}
          </p>
          <ul aria-label={`Revisions for ${rule.defaults.source}`}>
            {rule.revisions.map((revision) => (
              <li key={revision.effectiveFrom}>
                Effective {revision.effectiveFrom} · {revision.schedule.cadence}{" "}
                · {money(revision.defaults.amountMinor, currency)} from{" "}
                {revision.defaults.source}
              </li>
            ))}
          </ul>
          {!rule.lastDate && (
            <div>
              <button type="button" onClick={() => onRevise(rule.ruleId)}>
                Revise income rule
              </button>
              <button type="button" onClick={() => onStop(rule.ruleId)}>
                Stop income rule
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}
