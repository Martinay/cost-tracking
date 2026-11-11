import { useI18n } from "../../i18n/I18nProvider";
export function ActivityEffort({
  item,
}: {
  item: {
    minutes: number;
    missingDurationCount?: number;
    quantities?: { unit: string; quantity: number }[];
  };
}) {
  const { t } = useI18n();
  return (
    <>
      {item.minutes > 0 ? (
        <>
          {item.minutes} {t("minutes")}
        </>
      ) : (
        t("Duration not recorded")
      )}
      {(item.missingDurationCount ?? 0) > 0 && item.minutes > 0 && (
        <>
          {" "}
          · {item.missingDurationCount} {t("tasks without duration")}
        </>
      )}
      {item.quantities?.map((q) => (
        <span key={q.unit}>
          {" "}
          · {q.quantity} {q.unit}
        </span>
      ))}
    </>
  );
}
