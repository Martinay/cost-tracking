import { useI18n } from "../../i18n/I18nProvider";
import type { ReactNode } from "react";

export function ReportTableRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      className="report-table-region"
      role="region"
      aria-label={t("{value0}; scroll horizontally if needed", {
        value0: label,
      })}
      tabIndex={0}
    >
      <p className="table-scroll-hint">
        {t(
          "Scroll horizontally to see all columns. Use arrow keys when this table is focused.",
        )}
      </p>
      {children}
    </div>
  );
}
