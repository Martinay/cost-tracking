import { formatMoney as money } from "../../i18n/format";
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
  return (
    <ReportTableRegion label={t("Monthly profit and loss table")}>
      <table aria-label={t("Monthly profit and loss")}>
        <caption>
          {t("Monthly horse comparison for ")}
          {month}
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
      </table>
    </ReportTableRegion>
  );
}
