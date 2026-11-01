/** Formats existing minor-unit report amounts using the selected interface locale. */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amountMinor / 100,
  );
}

/** Formats a calendar date in UTC to preserve its ISO day; invalid input remains readable. */
export function formatDate(value: string, locale: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(date);
}
