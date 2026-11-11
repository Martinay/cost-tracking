import { formatMonth, formatMoney as money } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
import { ReportTableRegion } from "./ReportTableRegion";
import type { ApiResponse } from "../../api/client";

export type PnlHorseRow = ApiResponse<
  "/api/v1/reports/monthly-pnl",
  "get"
>["items"][number] & { horseName: string };

export function PnlTable({
  month,
  currency,
  items,
}: {
  month: string;
  currency: string;
  items: PnlHorseRow[];
}) {
  const { t, locale } = useI18n();
  const totals = items.reduce(
    (sum, item) => ({
      income: sum.income + BigInt(item.incomeMinor),
      expense: sum.expense + BigInt(item.expenseMinor),
      net: sum.net + BigInt(item.netMinor),
    }),
    { income: 0n, expense: 0n, net: 0n },
  );
  return (
    <>
      <section aria-label={t("Monthly overall result")}>
        <dl className="monthly-overall">
          <div>
            <dt>{t("Income")}</dt>
            <dd>{money(totals.income, currency, locale)}</dd>
          </div>
          <div>
            <dt>{t("Expenses")}</dt>
            <dd>{money(totals.expense, currency, locale)}</dd>
          </div>
          <div>
            <dt>{t("Net")}</dt>
            <dd>{money(totals.net, currency, locale)}</dd>
          </div>
        </dl>
      </section>
      <ReportTableRegion label={t("Monthly profit and loss table")}>
        <table aria-label={t("Monthly profit and loss")}>
          <caption>
            {t("Monthly horse comparison for ")}
            {formatMonth(month, locale)}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("Horse")}</th>
              <th scope="col">{t("Income")}</th>
              <th scope="col">{t("Expenses")}</th>
              <th scope="col">{t("Net")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.horseId}>
                <th scope="row">
                  <a href={`/horses/${encodeURIComponent(item.horseId)}`}>
                    {item.horseName}
                  </a>
                </th>
                <td>{money(item.incomeMinor, currency, locale)}</td>
                <td>{money(item.expenseMinor, currency, locale)}</td>
                <td>{money(item.netMinor, currency, locale)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t("Total")}</th>
              <td>{money(totals.income, currency, locale)}</td>
              <td>{money(totals.expense, currency, locale)}</td>
              <td>{money(totals.net, currency, locale)}</td>
            </tr>
          </tfoot>
        </table>
      </ReportTableRegion>
    </>
  );
}
