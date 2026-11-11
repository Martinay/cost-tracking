import { useI18n } from "../i18n/I18nProvider";
import { formatDate, formatMoney } from "../i18n/format";
import type { ApiResponse } from "../api/client";
type Item = ApiResponse<"/api/v1/history", "get">["items"][number];
export function HistoryDetails({
  item,
  currency = "EUR",
}: {
  item: Item;
  currency?: string;
}) {
  const { t, locale } = useI18n();
  const changes = item.changes as Record<string, unknown>;
  const previous = item.previous as Record<string, unknown> | null | undefined;
  const values =
    changes?.defaults && typeof changes.defaults === "object"
      ? (changes.defaults as Record<string, unknown>)
      : changes;
  if (!values) return null;
  const date =
    values.expenseDate ??
    values.receivedDate ??
    values.taskDate ??
    changes.scheduledDate;
  const names = item.horses ?? [];
  const amount =
    typeof values.amountMinor === "number" ? values.amountMinor : null;
  const allocations = Array.isArray(values.allocations)
    ? (values.allocations as { horseId: string; amountMinor: number }[])
    : [];
  const status = typeof values.status === "string" ? values.status : null;
  const oldStatus =
    typeof previous?.status === "string" ? previous.status : null;
  const description = values.description ?? values.source ?? values.notes;
  const path = values.expenseId
    ? `/expenses?month=${String(date).slice(0, 7)}`
    : values.incomeId
      ? `/income?month=${String(date).slice(0, 7)}`
      : changes.ruleId
        ? "/approvals"
        : values.taskId
          ? "/tasks"
          : null;
  return (
    <div className="history-detail">
      <p>
        {names.map((h) => (
          <span key={h.horseId}>
            <a href={`/horses/${h.horseId}`}>{h.name}</a>{" "}
          </span>
        ))}
        {amount !== null && <>{formatMoney(amount, currency, locale)} · </>}
        {typeof description === "string" && description}
        {status && (
          <>
            {" "}
            {oldStatus && <>{t(oldStatus)} → </>}
            {t(status)}
          </>
        )}
        {typeof date === "string" && <> · {formatDate(date, locale)}</>}
      </p>
      {typeof values.category === "string" && <p>{t(values.category)}</p>}
      {typeof values.minutes === "number" && values.minutes > 0 && (
        <p>
          {values.minutes} {t("minutes")}
        </p>
      )}
      {typeof values.quantity === "number" && (
        <p>
          {values.quantity} {String(values.quantityUnit ?? "")}
        </p>
      )}
      {allocations.length > 0 && (
        <ul>
          {allocations.map((a) => (
            <li key={a.horseId}>
              {names.find((h) => h.horseId === a.horseId)?.name ?? t("Horse")}:{" "}
              {formatMoney(a.amountMinor, currency, locale)}
            </li>
          ))}
        </ul>
      )}
      {typeof values.reason === "string" && (
        <p>
          {t("Reason for correction")}: {values.reason}
        </p>
      )}
      {previous && item.type.endsWith("Corrected") && (
        <p>
          {t("Previous amount")}:{" "}
          {typeof previous.amountMinor === "number"
            ? formatMoney(previous.amountMinor, currency, locale)
            : ""}{" "}
          ·{" "}
          {String(
            previous.description ?? previous.source ?? previous.notes ?? "",
          )}
        </p>
      )}
      {path && <a href={path}>{t("View related records")}</a>}
    </div>
  );
}
