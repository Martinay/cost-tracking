export function ratePrecision(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function currencySymbol(currency: string, locale: string): string {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency
  );
}
export function parseRateMajor(value: string, currency = "EUR"): number {
  const precision = ratePrecision(currency);
  if (!new RegExp(`^\\d+(?:[.,]\\d{0,${precision + 4}})?$`).test(value.trim()))
    return NaN;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const padded = fraction.padEnd(precision + 4, "0");
  return Number(
    `${whole}${padded.slice(0, precision)}.${padded.slice(precision)}`,
  );
}
export function formatRate(
  rateMinor: number,
  currency: string,
  locale: string,
): string {
  const precision = ratePrecision(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision + 4,
  }).format(rateMinor / 10 ** precision);
}
