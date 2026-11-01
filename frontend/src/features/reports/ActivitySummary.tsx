import { formatDate } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
import type { ApiResponse } from "../../api/client";
import { ReportTableRegion } from "./ReportTableRegion";

export type ActivityItem = ApiResponse<
  "/api/v1/reports/activity",
  "get"
>["items"][number];

export function ActivitySummary({
  from,
  to,
  items,
  horseName,
}: {
  from: string;
  to: string;
  items: ActivityItem[];
  horseName?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <ReportTableRegion label={t("Activity summary table")}>
      <table aria-label={t("Activity summary")}>
        <caption>
          {t("Activity")}
          {horseName ? t(" for {value0}", { value0: horseName }) : ""} ·{" "}
          {formatDate(from, locale)} {t("through ")}
          {formatDate(to, locale)}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("Activity")}</th>
            <th scope="col">{t("Tasks")}</th>
            <th scope="col">{t("Duration")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.taskType}>
              <th scope="row">{t(item.taskType)}</th>
              <td>{item.count}</td>
              <td>
                {item.minutes} {t("minutes")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTableRegion>
  );
}
