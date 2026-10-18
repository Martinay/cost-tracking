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
  const [editing, setEditing] = useState(false);
  const [receivedDate, setReceivedDate] = useState(today);
  const [amount, setAmount] = useState((item.amountMinor / 100).toFixed(2));
  const [split, setSplit] = useState<SplitValue>(
    item.splitMode === "Custom"
      ? {
          mode: "Custom",
          shares: item.allocations.map(({ horseId, weight }) => ({
            horseId,
            weight,
          })),
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
  const [error, setError] = useState("");
  const rejectTrigger = useRef<HTMLButtonElement>(null);
  const rejectDialog = useRef<HTMLDivElement>(null);
  const amountMinor = Number.isFinite(Number(amount))
    ? Math.round(Number(amount) * 100)
    : 0;
  const fingerprint = JSON.stringify({ receivedDate, amountMinor, split });
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
    const values = { receivedDate, amountMinor, split };
    try {
      setPending(true);
      const next = await onPreview({
        kind: "Income",
        values: { ...values, source: item.source },
      });
      setPreview(next);
      setPreviewFingerprint(JSON.stringify(values));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
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
      await onApprove({ receivedDate, amountMinor, split });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The payment could not be approved.",
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
        reason instanceof Error
          ? reason.message
          : "The payment could not be rejected.",
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
        Scheduled date:{" "}
        <time dateTime={item.scheduledDate}>{item.scheduledDate}</time>
      </p>
      <p>Expected amount: {money(item.amountMinor, currency)}</p>
      <p>Pending</p>
      {item.allocations.some(
        (allocation) =>
          !horses.some(
            (horse) =>
              horse.horseId === allocation.horseId &&
              (horse.status === "Active" || horse.status === "Leased"),
          ),
      ) && (
        <p>
          Keep the existing split to settle this inactive-horse obligation.
          Changing targets requires active or leased horses.
        </p>
      )}
      {editing && (
        <div>
          <label htmlFor={`received-${item.ruleId}-${item.scheduledDate}`}>
            Actual received date
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
            Actual amount
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
      {error && <p role="alert">{error}</p>}
      {previewCurrent && preview && (
        <section aria-label="Approval preview">
          <h4>Authoritative approval preview</h4>
          <p>
            Actual received date:{" "}
            <time dateTime={receivedDate}>{receivedDate}</time>
          </p>
          <p>
            Amount: {money(preview.amountMinor, preview.currency ?? currency)}
          </p>
          <ul aria-label="Approval preview allocations">
            {preview.allocations.map((allocation) => (
              <li key={allocation.horseId}>
                {horses.find((horse) => horse.horseId === allocation.horseId)
                  ?.name ?? allocation.horseId}
                : {money(allocation.amountMinor, preview.currency ?? currency)}
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
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setEditing(true);
            invalidatePreview();
          }}
        >
          Edit and approve
        </button>
        {editing && !previewCurrent && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void previewApproval()}
          >
            Preview approval
          </button>
        )}
        {previewCurrent && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void approve()}
          >
            Confirm approval
          </button>
        )}
        <button
          ref={rejectTrigger}
          type="button"
          disabled={pending}
          onClick={() => setRejecting(true)}
        >
          Reject
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
            Reject payment
          </h4>
          <p>This decision cannot be undone.</p>
          <button type="button" onClick={() => setRejecting(false)}>
            Keep pending
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void reject()}
          >
            Confirm rejection
          </button>
        </div>
      )}
    </article>
  );
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}
