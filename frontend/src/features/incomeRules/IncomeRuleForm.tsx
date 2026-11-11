import { editorShares } from "../finance/normalizeSplit";
import { useDraftState, clearDraftScope } from "../finance/useDraftState";
import { firstOccurrence } from "../recurrence/schedule";
import { formatDate, formatMoney as money } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
import { useState } from "react";
import type {
  FinancialHorse,
  FinancialPreview,
  SplitValue,
} from "../finance/useFinancialForm";
import { SplitFields } from "../finance/SplitFields";
import {
  ScheduleFields,
  type ScheduleValue,
} from "../recurrence/ScheduleFields";

export interface IncomeRuleValues {
  schedule: ScheduleValue;
  amountMinor: number;
  source: string;
  split: SplitValue;
}

export interface IncomeExampleValues {
  receivedDate: string;
  amountMinor: number;
  source: string;
  split: SplitValue;
}

export interface IncomeExampleRequest {
  kind: "Income";
  exampleOccurrence: true;
  exampleSchedule?: ScheduleValue;
  effectiveFrom?: string;
  values: IncomeExampleValues;
}

export interface IncomeRuleInitialValue {
  ruleId: string;
  startDate: string;
  effectiveFrom: string;
  schedule: ScheduleValue;
  defaults: {
    amountMinor: number;
    source: string;
    splitMode: string;
    allocations: { horseId: string; weight: number; amountMinor: number }[];
  };
  revisions: {
    effectiveFrom: string;
    schedule: ScheduleValue;
    defaults: IncomeRuleInitialValue["defaults"];
  }[];
  lastDate: string | null;
  nextScheduledDate?: string | null;
}

export interface IncomeRuleRevisionValues extends IncomeRuleValues {
  effectiveFrom: string;
}

export function IncomeRuleForm({
  currency,
  draftScope,
  today,
  horses,
  initialRule,
  onPreview,
  onCreate,
  onRevise,
}: {
  draftScope?: string | null;
  currency: string;
  today: string;
  horses: FinancialHorse[];
  initialRule?: IncomeRuleInitialValue;
  onPreview(request: IncomeExampleRequest): Promise<FinancialPreview>;
  onCreate(values: IncomeRuleValues): Promise<void>;
  onRevise?(values: IncomeRuleRevisionValues): Promise<void>;
}) {
  const { t, locale } = useI18n();
  const draftKey = "income-rule-" + (initialRule?.ruleId ?? "new");
  const [schedule, setSchedule] = useDraftState<ScheduleValue>(
    draftScope,
    draftKey + "-schedule",
    initialRule?.schedule ?? {
      cadence: "Weekly",
      interval: 1,
      weekdays: [],
      dayOfMonth: null,
      startDate: "",
      endDate: null,
    },
  );
  const [effectiveFrom, setEffectiveFrom] = useDraftState(
    draftScope,
    draftKey + "-effectiveFrom",
    "",
  );
  const [amount, setAmount] = useDraftState(
    draftScope,
    draftKey + "-amount",
    initialRule ? (initialRule.defaults.amountMinor / 100).toFixed(2) : "",
  );
  const [source, setSource] = useDraftState(
    draftScope,
    draftKey + "-source",
    initialRule?.defaults.source ?? "",
  );
  const [split, setSplit] = useDraftState<SplitValue>(
    draftScope,
    draftKey + "-split",
    initialRule
      ? incomeSplit(initialRule.defaults)
      : { mode: "Equal", horseIds: [] },
  );
  const [preview, setPreview] = useState<FinancialPreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [error, setError] = useState<string | Error>("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const amountMinor = parseMinor(amount);
  const values: IncomeRuleValues = {
    schedule,
    amountMinor: amountMinor ?? 0,
    source: source.trim(),
    split,
  };
  const exampleDate =
    firstOccurrence(
      schedule,
      initialRule ? effectiveFrom || schedule.startDate : schedule.startDate,
    ) ?? "";
  const fingerprint = JSON.stringify({ draftScope, values, effectiveFrom });
  const previewCurrent = preview !== null && previewKey === fingerprint;
  const selectedCount =
    split.mode === "Equal" ? split.horseIds.length : split.shares.length;

  function invalidate() {
    setPreview(null);
    setPreviewKey("");
    setError("");
    setStatus("");
  }

  function validate(): boolean {
    if (!exampleDate) {
      setError(
        "This schedule has no occurrence on or after the selected date.",
      );
      return false;
    }
    if (amountMinor === null || amountMinor <= 0) {
      setError("Enter a positive amount with no more than two decimal places.");
      return false;
    }
    if (!source.trim() || !schedule.startDate) {
      setError("Complete the source and schedule start date.");
      return false;
    }
    if (schedule.endDate && schedule.endDate < schedule.startDate) {
      setError("The inclusive end date cannot be before the start date.");
      return false;
    }
    if (initialRule && (!effectiveFrom || effectiveFrom <= today)) {
      setError("A rule revision must take effect after today.");
      return false;
    }
    if (selectedCount === 0) {
      setError("Choose at least one horse for this income.");
      return false;
    }
    return true;
  }

  async function previewExample() {
    setError("");
    setStatus("");
    if (!validate()) return;
    setPending(true);
    try {
      const result = await onPreview({
        kind: "Income",
        exampleOccurrence: true,
        exampleSchedule: schedule,
        ...(initialRule ? { effectiveFrom } : {}),
        values: {
          receivedDate: exampleDate,
          amountMinor: amountMinor!,
          source: source.trim(),
          split,
        },
      });
      setPreview(result);
      setPreviewKey(fingerprint);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : "The example occurrence could not be previewed.",
      );
    } finally {
      setPending(false);
    }
  }

  async function save() {
    setError("");
    setStatus("");
    if (!validate()) return;
    if (!previewCurrent) {
      setError(
        initialRule
          ? "Preview the example occurrence before saving the revision."
          : "Preview the example occurrence before creating the rule.",
      );
      return;
    }
    setPending(true);
    try {
      if (initialRule) {
        if (!onRevise)
          throw new Error("Income rule revisions are unavailable.");
        await onRevise({ ...values, effectiveFrom });
        clearDraftScope(draftScope, draftKey);
        setStatus("Income rule revision saved.");
      } else {
        await onCreate(values);
        clearDraftScope(draftScope, draftKey);
        setStatus("Income rule created.");
        setAmount("");
        setSource("");
        setSplit({ mode: "Equal", horseIds: [] });
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : "The income rule could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={t("Recurring income rule form")}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <ScheduleFields
        value={schedule}
        onChange={(next) => {
          invalidate();
          setSchedule(next);
        }}
      />
      {initialRule && (
        <>
          <label htmlFor="income-rule-effective-from">
            {t("Effective from (future date)")}
          </label>
          <input
            id="income-rule-effective-from"
            type="date"
            min={today}
            value={effectiveFrom}
            onChange={(event) => {
              invalidate();
              setEffectiveFrom(event.currentTarget.value);
            }}
            required
          />
          <p>
            {t("The original start date keeps the repeating dates aligned.")}
          </p>
        </>
      )}
      <label htmlFor="income-rule-amount">{t("Amount")}</label>
      <input
        id="income-rule-amount"
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(event) => {
          invalidate();
          setAmount(event.currentTarget.value);
        }}
        required
      />
      <label htmlFor="income-rule-source">{t("Source")}</label>
      <input
        id="income-rule-source"
        maxLength={100}
        value={source}
        onChange={(event) => {
          invalidate();
          setSource(event.currentTarget.value);
        }}
        required
      />
      <SplitFields
        horses={horses}
        value={split}
        onChange={(next) => {
          invalidate();
          setSplit(next);
        }}
      />
      {error && <p role="alert">{t(error)}</p>}
      {status && <p role="status">{t(status)}</p>}
      {previewCurrent && preview && (
        <section aria-label={t("Example occurrence")}>
          <h3>{t("Example occurrence")}</h3>
          <p>
            {formatDate(preview.date, locale)} ·{" "}
            {money(preview.amountMinor, preview.currency || currency, locale)}
          </p>
          <ul aria-label={t("Example occurrence allocations")}>
            {preview.allocations.map((allocation) => (
              <li key={allocation.horseId}>
                {horses.find((horse) => horse.horseId === allocation.horseId)
                  ?.name ?? allocation.horseId}
                :{" "}
                {money(
                  allocation.amountMinor,
                  preview.currency || currency,
                  locale,
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => void previewExample()}
      >
        {pending ? t("Previewing…") : t("Preview example occurrence")}
      </button>
      <button type="submit" disabled={pending || !previewCurrent}>
        {pending
          ? t("Saving income rule…")
          : initialRule
            ? t("Save income rule revision")
            : t("Create income rule")}
      </button>
    </form>
  );
}

function parseMinor(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [units, cents = ""] = value.trim().split(".");
  return Number(units) * 100 + Number(cents.padEnd(2, "0"));
}

function incomeSplit(defaults: IncomeRuleInitialValue["defaults"]): SplitValue {
  return defaults.splitMode === "Custom"
    ? {
        mode: "Custom",
        shares: editorShares(defaults.allocations),
      }
    : {
        mode: "Equal",
        horseIds: defaults.allocations.map(({ horseId }) => horseId),
      };
}
