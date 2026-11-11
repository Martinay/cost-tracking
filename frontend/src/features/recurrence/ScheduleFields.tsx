import { useI18n } from "../../i18n/I18nProvider";
export type ScheduleCadence = "Daily" | "Weekly" | "Weekdays" | "Monthly";

export interface ScheduleValue {
  cadence: ScheduleCadence;
  interval: number;
  weekdays: number[];
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
}

const isoWeekdays = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
] as const;

export function ScheduleFields({
  value,
  onChange,
}: {
  value: ScheduleValue;
  onChange(value: ScheduleValue): void;
}) {
  const { t } = useI18n();
  function change<K extends keyof ScheduleValue>(
    key: K,
    next: ScheduleValue[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  return (
    <fieldset>
      <legend>{t("Schedule")}</legend>
      <label htmlFor="schedule-cadence">{t("Repeats")}</label>
      <select
        id="schedule-cadence"
        value={value.cadence}
        onChange={(event) => {
          const cadence = event.currentTarget.value as ScheduleCadence;
          onChange({
            ...value,
            cadence,
            interval: cadence === "Weekdays" ? 1 : value.interval,
            weekdays: cadence === "Weekdays" ? value.weekdays : [],
            dayOfMonth: cadence === "Monthly" ? (value.dayOfMonth ?? 1) : null,
          });
        }}
      >
        <option value="Daily">{t("Daily")}</option>
        <option value="Weekly">{t("Weekly")}</option>
        <option value="Weekdays">{t("Selected weekdays")}</option>
        <option value="Monthly">{t("Monthly")}</option>
      </select>
      {value.cadence !== "Weekdays" && (
        <>
          <label htmlFor="schedule-interval">{t("Every")}</label>
          <input
            id="schedule-interval"
            type="number"
            min="1"
            max="366"
            step="1"
            required
            value={value.interval}
            onChange={(event) =>
              change("interval", Number(event.currentTarget.value))
            }
          />
        </>
      )}
      {value.cadence === "Weekdays" && (
        <fieldset>
          <legend>{t("Weekdays")}</legend>
          {isoWeekdays.map(([day, label]) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={value.weekdays.includes(day)}
                onChange={(event) =>
                  change(
                    "weekdays",
                    event.currentTarget.checked
                      ? [...value.weekdays, day]
                      : value.weekdays.filter((item) => item !== day),
                  )
                }
              />
              {t(label)}
            </label>
          ))}
        </fieldset>
      )}
      {value.cadence === "Monthly" && (
        <>
          <label htmlFor="schedule-day-of-month">{t("Day of month")}</label>
          <input
            id="schedule-day-of-month"
            type="number"
            min="1"
            max="31"
            step="1"
            required
            value={value.dayOfMonth ?? ""}
            onChange={(event) =>
              change(
                "dayOfMonth",
                event.currentTarget.value
                  ? Number(event.currentTarget.value)
                  : null,
              )
            }
          />
        </>
      )}
      <label htmlFor="schedule-start-date">{t("Start date")}</label>
      <input
        id="schedule-start-date"
        type="date"
        value={value.startDate}
        onChange={(event) => change("startDate", event.currentTarget.value)}
        required
      />
      <label htmlFor="schedule-end-date">{t("End date (inclusive)")}</label>
      <input
        id="schedule-end-date"
        type="date"
        min={value.startDate || undefined}
        value={value.endDate ?? ""}
        onChange={(event) =>
          change("endDate", event.currentTarget.value || null)
        }
      />
      <p>{t("Start and end dates are inclusive.")}</p>
    </fieldset>
  );
}
