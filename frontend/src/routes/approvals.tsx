import { formatDate, formatMoney as money } from "../i18n/format";
import { useI18n } from "../i18n/I18nProvider";
import { PageHeading } from "../components/PageHeading";
import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import type { ApiCommand, ApiRequestBody, ApiResponse } from "../api/client";
import { createQueryKeys, invalidateSubjectLists } from "../api/queryKeys";
import { useAuthServices } from "../auth/AuthBoundary";
import { removeDecidedApprovalFromCache } from "../features/approvals/approvalCache";
import {
  IncomeDecisionDialogs,
  type IncomeDecisionPreviewRequest,
  type IncomeDecisionValues,
  type PendingIncomeItem,
} from "../features/approvals/IncomeDecisionDialogs";
type ApprovalPage = ApiResponse<"/api/v1/income-approvals", "get">;
type IncomeDecisionPath =
  | `/api/v1/income-rules/${string}/occurrences/${string}/approve`
  | `/api/v1/income-rules/${string}/occurrences/${string}/reject`;
type IncomeDecisionCommand = ApiCommand<IncomeDecisionPath, "POST">;
type IncomeDecisionResponse =
  | ApiResponse<
      "/api/v1/income-rules/{ruleId}/occurrences/{scheduledDate}/approve",
      "post"
    >
  | ApiResponse<
      "/api/v1/income-rules/{ruleId}/occurrences/{scheduledDate}/reject",
      "post"
    >;
interface ApprovalPageParam {
  cursor: string | null;
  streamVersion: number | null;
  asOfDate: string | null;
}

export function ApprovalsRoute() {
  const { t, locale, errorText } = useI18n();
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const keys = subject ? createQueryKeys(subject) : null;
  const [fromOverride, setFromOverride] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [decisionNotice, setDecisionNotice] = useState("");
  const pendingCommand = useRef<IncomeDecisionCommand | null>(null);
  const account = useQuery({
    queryKey: keys?.account ?? ["account", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    queryFn: async () => {
      const result = await apiClient.get({
        subject: subject!,
        path: "/api/v1/account",
      });
      apiClient.rememberVersion(subject!, result.streamVersion);
      return result;
    },
  });
  const horses = useQuery({
    queryKey: keys?.horses() ?? ["horses", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    queryFn: async () =>
      await apiClient.get({
        subject: subject!,
        path: "/api/v1/horses",
      }),
  });
  const today =
    account.data?.ownerToday ?? new Date().toISOString().slice(0, 10);
  const startOfMonth = `${today.slice(0, 7)}-01`;
  const from = fromOverride ?? startOfMonth;
  const approvalKey = keys?.approvals(today, { from, reload }) ?? [
    "approvals",
    "unavailable",
    today,
    from,
    reload,
  ];
  const approvals = useInfiniteQuery<
    ApprovalPage,
    Error,
    InfiniteData<ApprovalPage>,
    QueryKey,
    ApprovalPageParam
  >({
    queryKey: approvalKey,
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    retry: false,
    initialPageParam: { cursor: null, streamVersion: null, asOfDate: null },
    queryFn: async ({ pageParam }) => {
      if (pageParam.cursor && pageParam.streamVersion !== null) {
        const latest = apiClient.lastSeenVersion(subject!);
        if (latest !== undefined && latest !== pageParam.streamVersion)
          throw new Error(
            "The inbox changed while paging. Restart this window to load the current pending payments.",
          );
      }
      const query = new URLSearchParams({ from, through: today, limit: "50" });
      if (pageParam.cursor) query.set("cursor", pageParam.cursor);
      const page = await apiClient.get({
        subject: subject!,
        path: `/api/v1/income-approvals?${query}`,
      });
      if (pageParam.asOfDate && page.asOfDate !== pageParam.asOfDate)
        throw new Error(
          "The inbox date changed while paging. Restart this window.",
        );
      if (
        pageParam.streamVersion !== null &&
        page.streamVersion !== pageParam.streamVersion
      )
        throw new Error(
          "The inbox version changed while paging. Restart this window.",
        );
      apiClient.rememberVersion(subject!, page.streamVersion);
      return page;
    },
    getNextPageParam: (page) =>
      page.nextCursor
        ? {
            cursor: page.nextCursor,
            streamVersion: page.streamVersion,
            asOfDate: page.asOfDate,
          }
        : undefined,
  });
  const items = approvals.data?.pages.flatMap((page) => page.items) ?? [];
  const currency = account.data?.currency ?? "EUR";
  const invalidateDecision = async (streamVersion: number) => {
    if (!subject) return;
    apiClient.rememberVersion(subject, streamVersion);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["approvals", subject] }),
      invalidateSubjectLists(queryClient, subject, "income"),
      queryClient.invalidateQueries({ queryKey: ["account", subject] }),
      queryClient.invalidateQueries({ queryKey: ["history", subject] }),
      queryClient.invalidateQueries({ queryKey: ["report", subject] }),
    ]);
  };
  const preview = async (request: IncomeDecisionPreviewRequest) => {
    if (!subject)
      throw new Error("Your session changed. Please sign in again.");
    return await apiClient.preview({
      subject,
      path: "/api/v1/previews/financial",
      body: request,
    });
  };
  const sendDecision = async (
    item: PendingIncomeItem,
    decision: "approve" | "reject",
    values?: IncomeDecisionValues,
  ) => {
    if (!subject)
      throw new Error("Your session changed. Please sign in again.");
    setDecisionNotice("");
    const path =
      `/api/v1/income-rules/${encodeURIComponent(item.ruleId)}/occurrences/${item.scheduledDate}/${decision}` as IncomeDecisionPath;
    const body = decision === "approve" ? values! : {};
    const streamVersion =
      apiClient.lastSeenVersion(subject) ?? account.data?.streamVersion ?? 0;
    const serialized = JSON.stringify(body);
    let command = pendingCommand.current;
    if (
      !command ||
      command.subject !== subject ||
      command.path !== path ||
      command.body !== serialized ||
      command.streamVersion !== streamVersion
    ) {
      command = apiClient.createCommand({
        subject,
        method: "POST",
        path,
        body: body as ApiRequestBody<typeof path, "post">,
        streamVersion,
      });
      pendingCommand.current = command;
    }
    try {
      const result = (await apiClient.sendCommand(
        command,
      )) as IncomeDecisionResponse;
      pendingCommand.current = null;
      if (!values?.partial)
        removeDecidedApprovalFromCache(queryClient, approvalKey, item);
      await invalidateDecision(result.streamVersion);
      setDecisionNotice(
        t("{source}: decision saved.", { source: item.source }),
      );
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        await queryClient.invalidateQueries({ queryKey: approvalKey });
        const refreshed =
          queryClient.getQueryData<InfiniteData<ApprovalPage>>(approvalKey);
        const stillPending = refreshed?.pages.some((page) =>
          page.items.some(
            (pending) =>
              pending.ruleId === item.ruleId &&
              pending.scheduledDate === item.scheduledDate,
          ),
        );
        setDecisionNotice(
          stillPending
            ? "The account changed in another tab. The inbox has been refreshed; review before trying again."
            : "This payment was already processed in another tab. The inbox has been refreshed.",
        );
      }
      throw error;
    }
  };

  return (
    <section aria-labelledby="approvals-heading">
      <PageHeading
        id="approvals-heading"
        title={t("Income approvals")}
        description={t(
          "Review scheduled payments and confirm what has arrived.",
        )}
      />
      <label htmlFor="approval-from">{t("Scheduled dates from")}</label>
      <input
        id="approval-from"
        type="date"
        max={today}
        value={from}
        onChange={(event) => setFromOverride(event.currentTarget.value)}
      />
      <p>
        {t("Window being viewed: ")}
        {formatDate(from, locale)} {t("through ")}
        {formatDate(today, locale)} {t("· as of")}{" "}
        {formatDate(approvals.data?.pages[0]?.asOfDate ?? today, locale)}
      </p>
      <section aria-labelledby="decision-history-heading">
        <h2 id="decision-history-heading">{t("Payment decision history")}</h2>
        <p>
          {t(
            "Final decisions stay in history. Correct one-off entries from the income ledger; rejected payments cannot be undone.",
          )}
        </p>
        <ol>
          {(approvals.data?.pages[0]?.history ?? []).map((item) => (
            <li key={item.streamVersion}>
              <strong>{item.source}</strong> ·{" "}
              {formatDate(item.scheduledDate, locale)} · {t(item.outcome)}
              <p>
                {t("Expected")}: {money(item.expectedMinor, currency, locale)} ·{" "}
                {t("Received")}: {money(item.receivedMinor, currency, locale)} ·{" "}
                {t("Difference")}:{" "}
                {money(
                  item.expectedMinor - item.receivedMinor,
                  currency,
                  locale,
                )}
              </p>
              {item.receivedDate && (
                <p>
                  {t("Received")}: {formatDate(item.receivedDate, locale)}
                </p>
              )}
              <p>
                {item.allocations
                  .map(
                    (a) =>
                      horses.data?.items.find((h) => h.horseId === a.horseId)
                        ?.name ?? t("Horse"),
                  )
                  .join(", ")}
              </p>
            </li>
          ))}
        </ol>
      </section>
      {decisionNotice && (
        <p role="status">
          {t(decisionNotice)}{" "}
          <a href="#decision-history-heading">{t("View payment decision")}</a>
        </p>
      )}
      {from > startOfMonth && (
        <button
          type="button"
          onClick={() => setFromOverride(previousMonth(from))}
        >
          {t("Earlier pending payments")}
        </button>
      )}
      {(account.isPending || horses.isPending) && (
        <p role="status">{t("Loading approval setup…")}</p>
      )}
      {(account.isError || horses.isError) && (
        <p role="alert">
          {t(
            "Approval setup could not be loaded. Retry the page after checking your connection.",
          )}
        </p>
      )}
      {approvals.isPending && (
        <p role="status">{t("Loading pending payments…")}</p>
      )}
      {approvals.isError && (
        <div role="alert">
          <p>
            {errorText(approvals.error) ||
              t("Pending payments could not be loaded.")}{" "}
            {t("If the window is too large, choose a later start date.")}
          </p>
          <button
            type="button"
            onClick={() => {
              queryClient.removeQueries({ queryKey: approvalKey, exact: true });
              setReload((value) => value + 1);
            }}
          >
            {t("Restart this window")}
          </button>
        </div>
      )}
      {!approvals.isPending && !approvals.isError && items.length === 0 && (
        <p>{t("No pending payments in this window.")}</p>
      )}
      {items.length > 0 && (
        <section aria-label={t("Pending payments")}>
          {items.map((item) => (
            <IncomeDecisionDialogs
              key={`${item.ruleId}-${item.scheduledDate}-${item.amountMinor}`}
              item={item}
              horses={horses.data?.items ?? []}
              currency={currency}
              today={today}
              onPreview={preview}
              onApprove={(values) => sendDecision(item, "approve", values)}
              onReject={() => sendDecision(item, "reject")}
            />
          ))}
        </section>
      )}
      {approvals.hasNextPage && !approvals.isError && (
        <button
          type="button"
          disabled={approvals.isFetchingNextPage}
          onClick={() => void approvals.fetchNextPage()}
        >
          {approvals.isFetchingNextPage
            ? t("Loading earlier payments…")
            : t("Load more pending payments")}
        </button>
      )}
    </section>
  );
}

function previousMonth(value: string): string {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}
