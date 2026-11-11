import { editorShares } from "../finance/normalizeSplit";
import { formatDate, formatMoney as money } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
import { useEffect, useRef, useState } from "react";
import type { ApiResponse } from "../../api/client";
import type {
  FinancialHorse,
  FinancialPreview,
  SplitValue,
} from "../finance/useFinancialForm";
import { SplitFields } from "../finance/SplitFields";

export type PendingIncomeItem = ApiResponse<
  "/api/v1/income-approvals",
  "get"
>["items"][number];

export interface IncomeDecisionValues {
  receivedDate: string;
  amountMinor: number;
  split: SplitValue;
  partial?: boolean;
}

export interface IncomeDecisionPreviewRequest {
  kind: "Income";
  values: {
    receivedDate: string;
    amountMinor: number;
    source: string;
    split: SplitValue;
  };
}

export function IncomeDecisionDialogs({
  item,
  horses,
  currency,
  today,
  onPreview,
  onApprove,
  onReject,
}: {
  item: PendingIncomeItem;
  horses: FinancialHorse[];
  currency: string;
  today: string;
  onPreview(request: IncomeDecisionPreviewRequest): Promise<FinancialPreview>;
  onApprove(values: IncomeDecisionValues): Promise<void>;
  onReject(): Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [partial, setPartial] = useState(false);
  const [editing, setEditing] = useState(false);
  const [receivedDate, setReceivedDate] = useState(today);
  const [amount, setAmount] = useState((item.amountMinor / 100).toFixed(2));
  const [split, setSplit] = useState<SplitValue>(
    item.splitMode === "Custom"
      ? {
          mode: "Custom",
          shares: editorShares(item.allocations),
        }
      : {
          mode: "Equal",
          horseIds: item.allocations.map(({ horseId }) => horseId),
        },
  );
  const [preview, setPreview] = useState<FinancialPreview | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | Error>("");
  const rejectTrigger = useRef<HTMLButtonElement>(null);
  const rejectDialog = useRef<HTMLDivElement>(null);
  const amountMinor = Number.isFinite(Number(amount))
    ? Math.round(Number(amount) * 100)
    : 0;
  const fingerprint = JSON.stringify({
    receivedDate,
    amountMinor,
    split,
    partial,
  });
  const previewCurrent = preview !== null && previewFingerprint === fingerprint;

  useEffect(() => {
    if (!rejecting) return;
    const trigger = rejectTrigger.current;
    rejectDialog.current?.querySelector<HTMLElement>("button")?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setRejecting(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      trigger?.focus();
    };
  }, [rejecting]);

  function invalidatePreview() {
    setPreview(null);
    setPreviewFingerprint("");
    setError("");
  }

  async function previewApproval() {
    setError("");
    if (!receivedDate || receivedDate > today || amountMinor <= 0) {
      setError("Enter an amount and a received date on or before today.");
      return;
    }
    const values = { receivedDate, amountMinor, split, partial };
    try {
      setPending(true);
      const next = await onPreview({
        kind: "Income",
        values: { receivedDate, amountMinor, split, source: item.source },
      });
      setPreview(next);
      setPreviewFingerprint(JSON.stringify(values));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : "The approval could not be previewed.",
      );
    } finally {
      setPending(false);
    }
  }

  async function approve() {
    if (!previewCurrent) {
      setError("Preview the payment before confirming approval.");
      return;
    }
    setError("");
    setPending(true);
    try {
      await onApprove({
        receivedDate,
        amountMinor,
        split,
        ...(partial ? { partial: true } : {}),
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason : "The payment could not be approved.",
      );
    } finally {
      setPending(false);
    }
  }

  async function reject() {
    setError("");
    setPending(true);
    try {
      await onReject();
      setRejecting(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason : "The payment could not be rejected.",
      );
      setRejecting(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <article aria-labelledby={`pending-${item.ruleId}-${item.scheduledDate}`}>
      <h3 id={`pending-${item.ruleId}-${item.scheduledDate}`}>{item.source}</h3>
      <p>
        {t("Scheduled date:")}{" "}
        <time dateTime={item.scheduledDate}>
          {formatDate(item.scheduledDate, locale)}
        </time>
      </p>
      <p>
        {t("Expected amount: ")}
        {money(item.amountMinor, currency, locale)}
      </p>
      <p>{t("Pending")}</p>
      <label>
        <input
          type="checkbox"
          checked={partial}
          onChange={(e) => {
            setPartial(e.target.checked);
            invalidatePreview();
          }}
        />
        {t("Partial receipt — keep the unpaid balance pending")}
      </label>
      <p>
        {partial
          ? t("Only this receipt is recorded. The remainder stays outstanding.")
          : t(
              "Final settlement: confirming closes this payment, including any difference.",
            )}
      </p>
      {item.allocations.some(
        (allocation) =>
          !horses.some(
            (horse) =>
              horse.horseId === allocation.horseId && horse.status !== "Sold",
          ),
      ) && (
        <p>
          {t(
            "Keep the existing split to settle this inactive-horse obligation. Changing targets requires active or leased horses.",
          )}
        </p>
      )}
      {editing && (
        <div>
          <label htmlFor={`received-${item.ruleId}-${item.scheduledDate}`}>
            {t("Actual received date")}
          </label>
          <input
            id={`received-${item.ruleId}-${item.scheduledDate}`}
            type="date"
            max={today}
            value={receivedDate}
            onChange={(event) => {
              invalidatePreview();
              setReceivedDate(event.currentTarget.value);
            }}
          />
          <label htmlFor={`amount-${item.ruleId}-${item.scheduledDate}`}>
            {t("Actual amount")}
          </label>
          <input
            id={`amount-${item.ruleId}-${item.scheduledDate}`}
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => {
              invalidatePreview();
              setAmount(event.currentTarget.value);
            }}
          />
          <SplitFields
            horses={horses}
            value={split}
            onChange={(next) => {
              invalidatePreview();
              setSplit(next);
            }}
          />
        </div>
      )}
      {error && <p role="alert">{t(error)}</p>}
      {previewCurrent && preview && (
        <section aria-label={t("Approval preview")}>
          <h4>{t("Confirm received payment")}</h4>
          <p>
            {t("Actual received date:")}{" "}
            <time dateTime={receivedDate}>
              {formatDate(receivedDate, locale)}
            </time>
          </p>
          <p>
            {t("Amount: ")}
            {money(preview.amountMinor, preview.currency ?? currency, locale)}
          </p>
          <p>
            {t("Difference from outstanding amount")}:{" "}
            {money(item.amountMinor - amountMinor, currency, locale)}
          </p>
          <ul aria-label={t("Approval preview allocations")}>
            {preview.allocations.map((allocation) => (
              <li key={allocation.horseId}>
                {horses.find((horse) => horse.horseId === allocation.horseId)
                  ?.name ?? allocation.horseId}
                :{" "}
                {money(
                  allocation.amountMinor,
                  preview.currency ?? currency,
                  locale,
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setEditing(false);
            void previewApproval();
          }}
        >
          {t("Approve")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setEditing(true);
            invalidatePreview();
          }}
        >
          {t("Edit and approve")}
        </button>
        {editing && !previewCurrent && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void previewApproval()}
          >
            {t("Preview approval")}
          </button>
        )}
        {previewCurrent && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void approve()}
          >
            {t("Confirm approval")}
          </button>
        )}
        <button
          ref={rejectTrigger}
          type="button"
          disabled={pending}
          onClick={() => setRejecting(true)}
        >
          {t("Reject")}
        </button>
      </div>
      {rejecting && (
        <div
          ref={rejectDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`reject-title-${item.ruleId}-${item.scheduledDate}`}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const buttons = rejectDialog.current?.querySelectorAll<HTMLElement>(
              "button:not([disabled])",
            );
            if (!buttons?.length) return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <h4 id={`reject-title-${item.ruleId}-${item.scheduledDate}`}>
            {t("Reject payment")}
          </h4>
          <p>{t("This decision cannot be undone.")}</p>
          <button type="button" onClick={() => setRejecting(false)}>
            {t("Keep pending")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void reject()}
          >
            {t("Confirm rejection")}
          </button>
        </div>
      )}
    </article>
  );
}
