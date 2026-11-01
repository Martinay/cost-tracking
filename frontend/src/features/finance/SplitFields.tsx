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
      <label htmlFor="split-mode">{t("Allocation")}</label>
      <select
        id="split-mode"
        value={mode}
        onChange={(event) =>
          selectMode(event.currentTarget.value as "Equal" | "Custom")
        }
      >
        <option value="Equal">{t("Equal split")}</option>
        <option value="Custom">{t("Custom weights")}</option>
      </select>
      {horses.map((horse) => {
        const active = horse.status === "Active" || horse.status === "Leased";
        const share =
          value.mode === "Custom"
            ? value.shares.find((item) => item.horseId === horse.horseId)
            : undefined;
        return (
          <div key={horse.horseId}>
            <label>
              <input
                aria-label={
                  horse.status === "Retired" || horse.status === "Sold"
                    ? t("{value0} ({value1})", {
                        value0: horse.name,
                        value1: t(horse.status),
                      })
                    : horse.name
                }
                checked={selected.includes(horse.horseId)}
                disabled={!active}
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
                  {t("Weight for ")}
                  {horse.name}
                  <input
                    aria-label={t("Weight for {value0}", {
                      value0: horse.name,
                    })}
                    min="1"
                    step="1"
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
