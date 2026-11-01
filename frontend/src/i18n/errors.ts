import { ApiError } from "../api/client";
import { german } from "./messages";

const recoveryMessages: Record<string, string> = {
  unauthenticated: "Sign in to continue.",
  not_found: "Resource unavailable.",
  version_conflict:
    "The data changed. Reload this view and review your entries.",
  settings_locked: "Settings are locked after financial activity.",
  storage_unavailable: "Storage is temporarily unavailable. Please try again.",
  rate_limited: "Too many requests. Please wait and try again.",
  invalid_cursor: "The list changed. Reload this view to continue.",
  invalid_amount:
    "Enter a positive amount with no more than two decimal places.",
  invalid_split: "Check the horse selection and allocation weights.",
  driving_rate_required:
    "No saved driving rate; enter one for this trip or save one in settings.",
  invalid_driving_rate:
    "Enter a positive rate with no more than four decimal places.",
  invalid_account_settings: "Check the currency and time zone.",
  invalid_horse: "Check the horse name, birth date and status.",
  invalid_task: "Check the horse, task date, duration and quantity.",
  invalid_schedule: "Check the schedule, interval and date range.",
  invalid_stop_date: "Choose an inclusive stop date that is today or later.",
  invalid_source: "Enter an income source.",
  invalid_description: "Enter a description.",
  invalid_expense_category: "Choose a category.",
};

/** Returns a known recovery message or the original diagnostic; never includes account data. */
export function errorSource(error: Error, localized: boolean): string {
  if (!localized || !(error instanceof ApiError)) return error.message;
  if (Object.hasOwn(german, error.message)) return error.message;
  return Object.hasOwn(recoveryMessages, error.code)
    ? recoveryMessages[error.code]
    : error.message;
}
