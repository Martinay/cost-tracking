import type { ApiResponse } from "../../api/client";
import { ReportTableRegion } from "./ReportTableRegion";

export type BreakdownItem = ApiResponse<
  "/api/v1/reports/breakdown",
  "get"
>["items"][number];

export function BreakdownTable({
  kind,
  currency,
  from,
  to,
  items,
  totalMinor,
  horseName,
}: {
  kind: "expense" | "income";
  currency: string;
  from: string;
  to: string;
  items: BreakdownItem[];
  totalMinor: number;
  horseName?: string;
}) {
  const noun = kind === "expense" ? "category" : "source";
  const label = kind === "expense" ? "Expense" : "Income";
  return (
    <ReportTableRegion label={`${label} breakdown table`}>
      <table aria-label={`${label} breakdown`}>
        <caption>
          {label} by {noun}
          {horseName ? ` for ${horseName}` : ""} · {from} through {to}
        </caption>
        <thead>
          <tr>
            <th scope="col">{kind === "expense" ? "Category" : "Source"}</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.label}>
              <th scope="row">{item.label}</th>
              <td>{money(item.amountMinor, currency)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total</th>
            <td>{money(totalMinor, currency)}</td>
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
