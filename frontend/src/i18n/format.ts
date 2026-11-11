/** Formats existing minor-unit report amounts using the selected interface locale. */
export function formatMoney(
  amountMinor: number | bigint,
  currency: string,
  locale: string,
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  if (typeof amountMinor === "number" && !Number.isSafeInteger(amountMinor))
    return formatter.format(amountMinor / 100);
  const minor = BigInt(amountMinor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const precision = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const whole = precision === 0 ? (absolute + 50n) / 100n : absolute / 100n;
  const signed = negative ? (whole === 0n ? -0 : -whole) : whole;
  const fraction = (absolute % 100n)
    .toString()
    .padStart(2, "0")
    .padEnd(precision, "0");
  return formatter
    .formatToParts(signed)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}

/** Formats a calendar date in UTC to preserve its ISO day; invalid input remains readable. */
export function formatDate(value: string, locale: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatMonth(value: string, locale: string): string {
  const date = new Date(`${value}-01T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}
