import { formatDate, formatMoney as money } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
import type { ApiResponse } from "../../api/client";
import { ReportTableRegion } from "./ReportTableRegion";

export type LifetimeReportPage = ApiResponse<"/api/v1/reports/lifetime", "get">;
export type ReportBalance = LifetimeReportPage["items"][number];

export function LifetimeTable({
  pages,
  horseNames,
}: {
  pages: LifetimeReportPage[];
  horseNames: ReadonlyMap<string, string>;
}) {
  const { t, locale } = useI18n();
  const lastPage = pages.at(-1);
  if (!lastPage?.complete) return null;

  // Every horse is one aggregate row in the API contract. Map by identity so a
  // repeated page caused by a refetch cannot double count a horse in the totals.
  const unique = new Map<string, ReportBalance>();
  for (const page of pages) {
    for (const item of page.items) unique.set(item.horseId, item);
  }
  const items = [...unique.values()];
  const totals = items.reduce(
    (sum, item) => ({
      incomeMinor: sum.incomeMinor + item.incomeMinor,
      expenseMinor: sum.expenseMinor + item.expenseMinor,
      netMinor: sum.netMinor + item.netMinor,
    }),
    { incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
  );

  return (
    <ReportTableRegion label={t("Lifetime totals table")}>
      <table aria-label={t("Lifetime totals")}>
        <caption>
          {t("Lifetime totals — Through ")}
          {formatDate(lastPage.asOfDate, locale)}
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
                {horseNames.get(item.horseId) ?? item.horseId}
              </th>
              <td>{money(item.incomeMinor, lastPage.currency, locale)}</td>
              <td>{money(item.expenseMinor, lastPage.currency, locale)}</td>
              <td>{money(item.netMinor, lastPage.currency, locale)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">{t("Total income")}</th>
            <td>{money(totals.incomeMinor, lastPage.currency, locale)}</td>
            <td>{money(totals.expenseMinor, lastPage.currency, locale)}</td>
            <td>{money(totals.netMinor, lastPage.currency, locale)}</td>
          </tr>
        </tbody>
      </table>
    </ReportTableRegion>
  );
}
