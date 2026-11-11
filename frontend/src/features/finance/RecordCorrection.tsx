import { editorShares } from "./normalizeSplit";
import { parseAmount } from "./useFinancialForm";
import { parseRateMajor, ratePrecision, currencySymbol } from "../driving/rate";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthServices } from "../../auth/AuthBoundary";
import { useI18n } from "../../i18n/I18nProvider";
import { formatMoney, formatMonth } from "../../i18n/format";
import { Modal } from "../../components/Modal";
import { ExpenseCategorySelect } from "../expenses/ExpenseCategorySelect";
import { SplitFields } from "./SplitFields";
import type {
  FinancialHorse,
  FinancialPreview,
  SplitValue,
} from "./useFinancialForm";
import type { ApiCommand } from "../../api/client";

type RecordValue = {
  id: string;
  amountMinor: number;
  expenseDate?: string;
  receivedDate?: string;
  category?: string;
  description?: string;
  source?: string;
  splitMode: string;
  allocations: { horseId: string; weight: number }[];
  driving?: { kilometers: number; rateMinorPerKm: number } | null;
};
export function RecordCorrection({
  kind,
  item,
  horses,
  currency,
}: {
  kind: "Expense" | "Income";
  item: RecordValue;
  horses: FinancialHorse[];
  currency: string;
}) {
  const { t, locale } = useI18n();
  const { subject, apiClient } = useAuthServices();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(item.expenseDate ?? item.receivedDate ?? "");
  const [amount, setAmount] = useState((item.amountMinor / 100).toFixed(2));
  const [detail, setDetail] = useState(item.category ?? item.source ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [kilometers, setKilometers] = useState(
    String(item.driving?.kilometers ?? ""),
  );
  const [rate, setRate] = useState(
    (
      (item.driving?.rateMinorPerKm ?? 0) /
      10 ** ratePrecision(currency)
    ).toFixed(ratePrecision(currency) + 4),
  );
  const [split, setSplit] = useState<SplitValue>(
    item.splitMode === "Custom"
      ? {
          mode: "Custom",
          shares: editorShares(item.allocations),
        }
      : { mode: "Equal", horseIds: item.allocations.map((a) => a.horseId) },
  );
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<FinancialPreview | null>(null);
  const [stamp, setStamp] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const command = useRef<ApiCommand | null>(null);
  const minor =
    kind === "Expense" && detail === "Driving"
      ? item.amountMinor
      : (parseAmount(amount) ?? 0);
  const values =
    kind === "Expense"
      ? {
          expenseDate: date,
          amountMinor: minor,
          category: detail,
          description,
          split,
          ...(detail === "Driving"
            ? {
                driving: {
                  kilometers: Number(kilometers),
                  rateMinorPerKm: parseRateMajor(rate, currency),
                },
              }
            : {}),
        }
      : { receivedDate: date, amountMinor: minor, source: detail, split };
  const fingerprint = JSON.stringify({ values, reason });
  const current = preview && stamp === fingerprint;
  async function previewNow() {
    setPending(true);
    setError("");
    try {
      const result = await apiClient.preview({
        subject: subject!,
        path: "/api/v1/previews/financial",
        body: { kind: kind + "Correction", recordId: item.id, values },
      });
      setPreview(result);
      setStamp(fingerprint);
      command.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction preview failed.");
    } finally {
      setPending(false);
    }
  }
  async function save() {
    if (!current || !reason.trim()) return;
    setPending(true);
    try {
      const path =
        kind === "Expense"
          ? (`/api/v1/expenses/${item.id}/corrections` as const)
          : (`/api/v1/income/${item.id}/corrections` as const);
      command.current ??= apiClient.createCommand({
        subject: subject!,
        method: "POST",
        path,
        body: { values, reason },
        streamVersion: preview!.streamVersion,
      });
      await apiClient.sendCommand(command.current);
      await queries.invalidateQueries({
        predicate: (q) => q.queryKey[1] === subject,
      });
      setOpen(false);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Correction could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSaved(false);
        }}
      >
        {t("Correct entry")}
      </button>
      {saved && (
        <p role="status">
          {t("Correction saved. Original retained in history.")}
        </p>
      )}
      {open && (
        <Modal
          labelledBy="correction-heading"
          onClose={() => !pending && setOpen(false)}
        >
          <h2 id="correction-heading">{t("Correct entry")}</h2>
          <p>
            {t(
              "The original entry stays in history. Preview the replacement and explain the correction.",
            )}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void previewNow();
            }}
          >
            <label>
              {t("Date")}
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {kind === "Expense" && detail === "Driving" ? (
              <>
                <label>
                  {t("Distance (km)")}
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    required
                    value={kilometers}
                    onChange={(e) => setKilometers(e.target.value)}
                  />
                </label>
                <label>
                  {t("Rate per km ({currency}/km)", {
                    currency: currencySymbol(currency, locale),
                  })}
                  <input
                    type="number"
                    min={10 ** -(ratePrecision(currency) + 4)}
                    step={10 ** -(ratePrecision(currency) + 4)}
                    required
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <label>
                {t("Amount")}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            {kind === "Expense" ? (
              detail !== "Driving" && (
                <ExpenseCategorySelect
                  id="correction-category"
                  value={detail}
                  onChange={setDetail}
                />
              )
            ) : (
              <label>
                {t("Source")}
                <input
                  required
                  maxLength={100}
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                />
              </label>
            )}
            {kind === "Expense" && (
              <label>
                {t("Description")}
                <input
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            )}
            <SplitFields horses={horses} value={split} onChange={setSplit} />
            <label>
              {t("Reason for correction")}
              <input
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button disabled={pending} type="submit">
              {t("Preview correction")}
            </button>
          </form>
          {current && (
            <section aria-label={t("Correction preview")}>
              <p>{formatMoney(preview.amountMinor, currency, locale)}</p>
              <ul>
                {preview.allocations.map((a) => (
                  <li key={a.horseId}>
                    {horses.find((h) => h.horseId === a.horseId)?.name}:{" "}
                    {formatMoney(a.amountMinor, currency, locale)}
                  </li>
                ))}
              </ul>
              <h3>{t("Monthly effect")}</h3>
              <ul>
                {preview.monthlyEffect.map((e) => (
                  <li key={e.month + e.horseId}>
                    {formatMonth(e.month, locale)} ·{" "}
                    {horses.find((h) => h.horseId === e.horseId)?.name} ·{" "}
                    {t("Net")}: {formatMoney(e.netDeltaMinor, currency, locale)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={pending || !reason.trim()}
                onClick={() => void save()}
              >
                {t("Save correction")}
              </button>
            </section>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            {t("Cancel")}
          </button>
        </Modal>
      )}
    </>
  );
}
