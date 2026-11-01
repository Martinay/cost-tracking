import { useId } from "react";
import { useI18n } from "../i18n/I18nProvider";

export function LanguageSelector() {
  const { language, setLanguage, t } = useI18n();
  const id = useId();
  return (
    <div className="language-selector">
      <label htmlFor={id}>{t("Language")}</label>
      <select
        id={id}
        value={language}
        onChange={(event) =>
          setLanguage(event.currentTarget.value === "de" ? "de" : "en")
        }
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="de" lang="de">
          Deutsch
        </option>
      </select>
    </div>
  );
}
