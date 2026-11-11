import type { ScheduleValue } from "./ScheduleFields";

export function firstOccurrence(
  schedule: ScheduleValue,
  from: string,
): string | null {
  if (!schedule.startDate || !from || schedule.interval < 1) return null;
  const anchor = new Date(schedule.startDate + "T00:00:00Z");
  const first = new Date(
    (from > schedule.startDate ? from : schedule.startDate) + "T00:00:00Z",
  );
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(first.getTime()))
    return null;
  for (let offset = 0; offset <= 366 * 5; offset++) {
    const day = new Date(first.getTime() + offset * 86400000);
    const iso = day.toISOString().slice(0, 10);
    if (schedule.endDate && iso > schedule.endDate) return null;
    const delta = Math.round((day.getTime() - anchor.getTime()) / 86400000);
    const months =
      (day.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      day.getUTCMonth() -
      anchor.getUTCMonth();
    const monthEnd = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const occurs =
      schedule.cadence === "Monthly"
        ? months % schedule.interval === 0 &&
          day.getUTCDate() === Math.min(schedule.dayOfMonth ?? 1, monthEnd)
        : schedule.cadence === "Weekdays"
          ? schedule.weekdays.includes(((day.getUTCDay() + 6) % 7) + 1)
          : delta %
              (schedule.interval * (schedule.cadence === "Weekly" ? 7 : 1)) ===
            0;
    if (occurs) return iso;
  }
  return null;
}
