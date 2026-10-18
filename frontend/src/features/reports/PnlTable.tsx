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
  return (
    <ReportTableRegion label="Monthly profit and loss table">
      <table aria-label="Monthly profit and loss">
        <caption>Monthly horse comparison for {month}</caption>
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
                <a href={`/horses/${encodeURIComponent(item.horseId)}`}>
                  {item.horseName}
                </a>
              </th>
              <td>{money(item.incomeMinor, currency)}</td>
              <td>{money(item.expenseMinor, currency)}</td>
              <td>{money(item.netMinor, currency)}</td>
            </tr>
          ))}
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
