import type { ReactNode } from "react";

export function ReportTableRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="report-table-region"
      role="region"
      aria-label={`${label}; scroll horizontally if needed`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
