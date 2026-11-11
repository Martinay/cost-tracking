import { useId } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { FinancialHorse, SplitValue } from "./useFinancialForm";

export function SplitFields({
  horses,
  value,
  onChange,
}: {
  horses: FinancialHorse[];
  value: SplitValue;
  onChange(next: SplitValue): void;
}) {
  const { t } = useI18n();
  const mode = value.mode;
  const splitId = useId();
  const selected =
    value.mode === "Equal"
      ? value.horseIds
      : value.shares.map((share) => share.horseId);
  function toggle(horseId: string, checked: boolean) {
    const ids = checked
      ? [...selected, horseId]
      : selected.filter((id) => id !== horseId);
    if (mode === "Equal") onChange({ mode, horseIds: ids });
    else
      onChange({
        mode,
        shares: ids.map((id) => ({
          horseId: id,
          weight:
            value.mode === "Custom"
              ? (value.shares.find((share) => share.horseId === id)?.weight ??
                1)
              : 1,
        })),
      });
  }
  function selectMode(next: "Equal" | "Custom") {
    onChange(
      next === "Equal"
        ? { mode: "Equal", horseIds: selected }
        : {
            mode: "Custom",
            shares: selected.map((horseId) => ({
              horseId,
              weight:
                value.mode === "Custom"
                  ? (value.shares.find((share) => share.horseId === horseId)
                      ?.weight ?? 1)
                  : 1,
            })),
          },
    );
  }
  return (
    <fieldset>
      <legend>{t("Split across horses")}</legend>
      <label htmlFor={splitId}>{t("Allocation")}</label>
      <select
        id={splitId}
        value={mode}
        onChange={(event) =>
          selectMode(event.currentTarget.value as "Equal" | "Custom")
        }
      >
        <option value="Equal">{t("Equal split")}</option>
        <option value="Custom">{t("Split differently")}</option>
      </select>
      {mode === "Custom" && (
        <p>
          {t(
            "Use ratios such as 2 and 1, or percentage shares such as 60 and 40. Saved shares are shown as percentages. Preview shows exact amounts.",
          )}
        </p>
      )}
      {horses.map((horse) => {
        const active = horse.status !== "Sold";
        const share =
          value.mode === "Custom"
            ? value.shares.find((item) => item.horseId === horse.horseId)
            : undefined;
        return (
          <div key={horse.horseId}>
            <label>
              <input
                aria-label={
                  horse.status === "Sold"
                    ? t("{value0} ({value1})", {
                        value0: horse.name,
                        value1: t(horse.status),
                      })
                    : horse.name
                }
                checked={selected.includes(horse.horseId)}
                disabled={!active && !selected.includes(horse.horseId)}
                onChange={(event) =>
                  toggle(horse.horseId, event.currentTarget.checked)
                }
                type="checkbox"
              />
              {horse.name}{" "}
              {active ? "" : t("({value0})", { value0: t(horse.status) })}
            </label>
            {mode === "Custom" &&
              active &&
              selected.includes(horse.horseId) && (
                <label>
                  {t("Share for ")}
                  {horse.name}
                  <input
                    aria-label={t("Share for {value0}", {
                      value0: horse.name,
                    })}
                    min="0.000001"
                    step="0.000001"
                    type="number"
                    value={share?.weight ?? 1}
                    onChange={(event) =>
                      onChange({
                        mode: "Custom",
                        shares:
                          value.mode === "Custom"
                            ? value.shares.map((item) =>
                                item.horseId === horse.horseId
                                  ? {
                                      ...item,
                                      weight: Number(event.currentTarget.value),
                                    }
                                  : item,
                              )
                            : selected.map((id) => ({
                                horseId: id,
                                weight:
                                  id === horse.horseId
                                    ? Number(event.currentTarget.value)
                                    : 1,
                              })),
                      })
                    }
                  />
                </label>
              )}
          </div>
        );
      })}
    </fieldset>
  );
}
