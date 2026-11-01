import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { errorSource } from "./errors";
import { german } from "./messages";

export type Language = "en" | "de";
type Values = Record<string, string | number>;
const englishLabels: Record<string, string> = {
  MedicalCare: "Medical Care",
  PaddockDuty: "Paddock Duty",
};
const preferenceKey = "horse-ledger.language";

function translate(
  language: Language,
  source: string | Error | null | undefined,
  values: Values = {},
): string {
  const original =
    source instanceof Error
      ? errorSource(source, language === "de")
      : (source ?? "");
  const catalogue = language === "de" ? german : englishLabels;
  const message = Object.hasOwn(catalogue, original)
    ? catalogue[original]
    : original;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
function translateError(
  language: Language,
  error: unknown,
  fallback?: string,
): string {
  if (
    fallback !== undefined &&
    (!(error instanceof Error) || fallback !== error.message)
  ) {
    return translate(language, fallback);
  }
  return translate(
    language,
    error instanceof Error
      ? error
      : (fallback ?? "This request could not be completed. Please try again."),
  );
}

const I18nContext = createContext({
  language: "en" as Language,
  locale: "en-US",
  setLanguage: (_language: Language) => {
    void _language;
  },
  errorText: (error: unknown, fallback?: string) =>
    translateError("en", error, fallback),
  t: (source: string | Error | null | undefined, values?: Values) =>
    translate("en", source, values),
});

function readPreference(): Language {
  try {
    return localStorage.getItem(preferenceKey) === "de" ? "de" : "en";
  } catch (error) {
    if (error instanceof DOMException) return "en";
    throw error;
  }
}

/** Provides browser-local interface language without remounting children or altering account state. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readPreference);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate(language, "Horse ledger");
  }, [language]);
  const value = useMemo(
    () => ({
      language,
      locale: language === "de" ? "de-DE" : "en-US",
      setLanguage(next: Language) {
        setLanguageState(next);
        try {
          localStorage.setItem(preferenceKey, next);
        } catch (error) {
          if (!(error instanceof DOMException)) throw error;
        }
      },
      errorText: (error: unknown, fallback?: string) =>
        translateError(language, error, fallback),
      t: (source: string | Error | null | undefined, values?: Values) =>
        translate(language, source, values),
    }),
    [language],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  return useContext(I18nContext);
}
