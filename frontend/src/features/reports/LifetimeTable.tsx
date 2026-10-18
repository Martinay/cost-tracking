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
    <ReportTableRegion label="Lifetime totals table">
      <table aria-label="Lifetime totals">
        <caption>Lifetime totals — Through {lastPage.asOfDate}</caption>
        <thead>
          <tr>
            <th scope="col">Horse</th>
            <th scope="col">Income</th>
            <th scope="col">Expenses</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.horseId}>
              <th scope="row">
                {horseNames.get(item.horseId) ?? item.horseId}
              </th>
              <td>{money(item.incomeMinor, lastPage.currency)}</td>
              <td>{money(item.expenseMinor, lastPage.currency)}</td>
              <td>{money(item.netMinor, lastPage.currency)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total income</th>
            <td>{money(totals.incomeMinor, lastPage.currency)}</td>
            <td>{money(totals.expenseMinor, lastPage.currency)}</td>
            <td>{money(totals.netMinor, lastPage.currency)}</td>
          </tr>
        </tbody>
      </table>
    </ReportTableRegion>
  );
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}
