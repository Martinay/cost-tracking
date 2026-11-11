import type { ScheduleValue } from "./ScheduleFields";
import { useI18n } from "../../i18n/I18nProvider";
import { formatDate } from "../../i18n/format";
export function ScheduleSummary({
  schedule,
  lastDate,
  today,
  nextScheduledDate,
}: {
  schedule: ScheduleValue;
  lastDate?: string | null;
  today?: string;
  nextScheduledDate?: string | null;
}) {
  const { t, locale } = useI18n();
  const end = [schedule.endDate, lastDate]
    .filter((v): v is string => Boolean(v))
    .sort()[0];
  const next = nextScheduledDate;
  const repeat =
    schedule.cadence === "Monthly"
      ? schedule.interval === 1
        ? t("Every month")
        : t("Every {count} months", { count: schedule.interval })
      : schedule.cadence === "Weekly"
        ? schedule.interval === 1
          ? t("Every week")
          : t("Every {count} weeks", { count: schedule.interval })
        : schedule.cadence === "Daily"
          ? schedule.interval === 1
            ? t("Every day")
            : t("Every {count} days", { count: schedule.interval })
          : t("Selected weekdays");
  return (
    <>
      <span>
        {repeat}
        {schedule.cadence === "Monthly" && (
          <>
            {" "}
            · {t("on day")} {schedule.dayOfMonth}
          </>
        )}
        {schedule.cadence === "Weekdays" && (
          <>
            {" "}
            ·{" "}
            {schedule.weekdays
              .map((day) =>
                new Intl.DateTimeFormat(locale, {
                  weekday: "long",
                  timeZone: "UTC",
                }).format(new Date(Date.UTC(2026, 10, day + 1))),
              )
              .join(", ")}
          </>
        )}
      </span>{" "}
      · {t("starts")} {formatDate(schedule.startDate, locale)}
      {end ? (
        <>
          {" "}
          · {t("inclusive through")} {formatDate(end, locale)}
        </>
      ) : (
        <> · {t("no end date")}</>
      )}
      {lastDate && (
        <>
          {" "}
          · {today && lastDate < today ? t("Stopped") : t("Stops after")}{" "}
          {formatDate(lastDate, locale)}
        </>
      )}
      {next && (
        <>
          {" "}
          · {t("Next scheduled date")} {formatDate(next, locale)}
        </>
      )}
    </>
  );
}
