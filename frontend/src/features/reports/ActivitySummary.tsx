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
  return (
    <ReportTableRegion label="Activity summary table">
      <table aria-label="Activity summary">
        <caption>
          Activity{horseName ? ` for ${horseName}` : ""} · {from} through {to}
        </caption>
        <thead>
          <tr>
            <th scope="col">Activity</th>
            <th scope="col">Tasks</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.taskType}>
              <th scope="row">
                {item.taskType.replace(/([a-z])([A-Z])/g, "$1 $2")}
              </th>
              <td>{item.count}</td>
              <td>{item.minutes} minutes</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTableRegion>
  );
}
