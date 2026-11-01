import { formatDate, formatMoney as money } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
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
  const { t, locale } = useI18n();
  const noun = kind === "expense" ? "category" : "source";
  const label = kind === "expense" ? "Expense" : "Income";
  return (
    <ReportTableRegion
      label={t("{value0} breakdown table", { value0: t(label) })}
    >
      <table aria-label={t("{value0} breakdown", { value0: t(label) })}>
        <caption>
          {t(label)} {t("by ")}
          {t(noun)}
          {horseName ? t(" for {value0}", { value0: horseName }) : ""} ·{" "}
          {formatDate(from, locale)} {t("through ")}
          {formatDate(to, locale)}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              {kind === "expense" ? t("Category") : t("Source")}
            </th>
            <th scope="col">{t("Amount")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.label}>
              <th scope="row">{item.label}</th>
              <td>{money(item.amountMinor, currency, locale)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">{t("Total")}</th>
            <td>{money(totalMinor, currency, locale)}</td>
          </tr>
        </tbody>
      </table>
    </ReportTableRegion>
  );
}
