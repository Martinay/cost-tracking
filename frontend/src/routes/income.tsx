import { formatMoney as money } from "../i18n/format";
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
import { IncomeForm } from "../features/income/IncomeForm";
import {
  IncomeRuleForm,
  type IncomeRuleRevisionValues,
  type IncomeRuleValues,
} from "../features/incomeRules/IncomeRuleForm";
import { IncomeRuleList } from "../features/incomeRules/IncomeRuleList";

type LedgerPage = ApiResponse<"/api/v1/income", "get">;
type IncomeRulePath =
  | "/api/v1/income-rules"
  | `/api/v1/income-rules/${string}`
  | `/api/v1/income-rules/${string}/stop`;
type IncomeRuleCommand = ApiCommand<IncomeRulePath, "POST" | "PATCH">;
type IncomeRuleMutationResponse =
  | ApiResponse<"/api/v1/income-rules", "post">
  | ApiResponse<"/api/v1/income-rules/{ruleId}", "patch">
  | ApiResponse<"/api/v1/income-rules/{ruleId}/stop", "post">;
interface PageParam {
  cursor: string | null;
  streamVersion: number | null;
}
type IncomeRulePage = ApiResponse<"/api/v1/income-rules", "get">;
interface IncomeRulePageParam {
  cursor: string | null;
  streamVersion: number | null;
}

export function IncomeRoute() {
  const { t, locale, errorText } = useI18n();
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [stoppingRuleId, setStoppingRuleId] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState("");
  const [ruleError, setRuleError] = useState<string | Error>("");
  const [ruleNotice, setRuleNotice] = useState("");
  const pendingRuleCommand = useRef<IncomeRuleCommand | null>(null);
  const keys = subject ? createQueryKeys(subject) : null;
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
  const through =
    account.data?.ownerToday ?? new Date().toISOString().slice(0, 10);
  const from = `${through.slice(0, 7)}-01`;
  const queryRange = { from, to: through };
  const incomeRules = useInfiniteQuery<
    IncomeRulePage,
    Error,
    InfiniteData<IncomeRulePage>,
    QueryKey,
    IncomeRulePageParam
  >({
    queryKey: keys?.incomeRules ?? ["incomeRules", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    initialPageParam: { cursor: null, streamVersion: null },
    queryFn: async ({ pageParam }) => {
      if (
        pageParam.cursor &&
        pageParam.streamVersion !== null &&
        subject &&
        apiClient.lastSeenVersion(subject) !== undefined &&
        apiClient.lastSeenVersion(subject) !== pageParam.streamVersion
      )
        throw new Error(
          "Income rules changed while paging. Reload the rules to continue.",
        );
      const query = new URLSearchParams({ limit: "100" });
      if (pageParam.cursor) query.set("cursor", pageParam.cursor);
      const path =
        `/api/v1/income-rules?${query}` as `/api/v1/income-rules?${string}`;
      const page = await apiClient.get({
        subject: subject!,
        path,
      });
      apiClient.rememberVersion(subject!, page.streamVersion);
      return page;
    },
    getNextPageParam: (page) =>
      page.nextCursor
        ? { cursor: page.nextCursor, streamVersion: page.streamVersion }
        : undefined,
  });
  const ruleEntries =
    incomeRules.data?.pages.flatMap((page) => page.items) ?? [];
  const editingRule = editingRuleId
    ? ruleEntries.find((rule) => rule.ruleId === editingRuleId)
    : undefined;
  const ledger = useInfiniteQuery<
    LedgerPage,
    Error,
    InfiniteData<LedgerPage>,
    QueryKey,
    PageParam
  >({
    queryKey: keys?.income(queryRange) ?? ["income", "unavailable"],
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    initialPageParam: { cursor: null, streamVersion: null } as PageParam,
    queryFn: async ({ pageParam }) => {
      if (pageParam.cursor && pageParam.streamVersion !== null && subject) {
        const latest = apiClient.lastSeenVersion(subject);
        if (latest !== undefined && latest !== pageParam.streamVersion)
          throw new Error(
            "Income changed while paging. Reload the ledger to continue.",
          );
      }
      const params = new URLSearchParams({ from, to: through, limit: "50" });
      if (pageParam.cursor) params.set("cursor", pageParam.cursor);
      const path = `/api/v1/income?${params}` as `/api/v1/income?${string}`;
      const result = await apiClient.get({
        subject: subject!,
        path,
      });
      apiClient.rememberVersion(subject!, result.streamVersion);
      return result;
    },
    getNextPageParam: (page) =>
      page.nextCursor
        ? { cursor: page.nextCursor, streamVersion: page.streamVersion }
        : undefined,
  });
  const entries = ledger.data?.pages.flatMap((page) => page.items) ?? [];
  const currency = account.data?.currency ?? "EUR";
  const runRuleCommand = async (
    method: "POST" | "PATCH",
    path: IncomeRulePath,
    body: unknown,
  ) => {
    if (!subject)
      throw new Error("Your session changed. Please sign in again.");
    const streamVersion =
      apiClient.lastSeenVersion(subject) ?? account.data?.streamVersion ?? 0;
    const serialized = JSON.stringify(body);
    let command = pendingRuleCommand.current;
    if (
      !command ||
      command.subject !== subject ||
      command.method !== method ||
      command.path !== path ||
      command.body !== serialized ||
      command.streamVersion !== streamVersion
    ) {
      command = apiClient.createCommand({
        subject,
        method,
        path,
        body: body as ApiRequestBody<typeof path, "post">,
        streamVersion,
      });
      pendingRuleCommand.current = command;
    }
    const result = (await apiClient.sendCommand(
      command,
    )) as IncomeRuleMutationResponse;
    pendingRuleCommand.current = null;
    apiClient.rememberVersion(subject, result.streamVersion);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys?.incomeRules }),
      invalidateSubjectLists(queryClient, subject, "income"),
      queryClient.invalidateQueries({ queryKey: ["account", subject] }),
      queryClient.invalidateQueries({ queryKey: ["history", subject] }),
      queryClient.invalidateQueries({ queryKey: ["report", subject] }),
    ]);
    return result;
  };
  const previewRule = async (request: {
    kind: "Income";
    exampleOccurrence: true;
    values: {
      receivedDate: string;
      amountMinor: number;
      source: string;
      split: IncomeRuleValues["split"];
    };
  }) => {
    if (!subject)
      throw new Error("Your session changed. Please sign in again.");
    return (await apiClient.preview({
      subject,
      path: "/api/v1/previews/financial",
      body: request,
    })) as import("../features/finance/useFinancialForm").FinancialPreview;
  };

  return (
    <section aria-labelledby="income-heading">
      <PageHeading
        id="income-heading"
        title={t("Income")}
        description={t(
          "Track your earnings and keep recurring payments on course.",
        )}
      />
      {canLoadProtectedData && (
        <button type="button" onClick={() => setRecording(true)}>
          {t("Record income")}
        </button>
      )}
      {canLoadProtectedData && recording && <IncomeForm />}
      {canLoadProtectedData && (
        <section aria-labelledby="income-rules-heading">
          <h2 id="income-rules-heading">{t("Recurring income")}</h2>
          <button
            type="button"
            onClick={() => {
              setEditingRuleId(null);
              setShowRuleForm((value) => !value);
            }}
          >
            {t("Create recurring income rule")}
          </button>
          {ruleNotice && <p role="status">{t(ruleNotice)}</p>}
          {incomeRules.isPending && (
            <p role="status">{t("Loading income rules…")}</p>
          )}
          {incomeRules.isError && (
            <div role="alert">
              <p>{errorText(incomeRules.error)}</p>
              <button type="button" onClick={() => void incomeRules.refetch()}>
                {t("Retry income rules")}
              </button>
            </div>
          )}
          {ruleEntries.length > 0 && (
            <IncomeRuleList
              rules={ruleEntries}
              currency={currency}
              onRevise={(id) => {
                setShowRuleForm(false);
                setEditingRuleId(id);
              }}
              onStop={(id) => {
                setRuleError("");
                setLastDate(through);
                setStoppingRuleId(id);
              }}
            />
          )}
          {(showRuleForm || editingRule) && account.data && horses.data && (
            <section
              aria-label={
                editingRule
                  ? t("Revise recurring income rule")
                  : t("Create recurring income rule")
              }
            >
              <h3>
                {editingRule
                  ? t("Revise recurring income rule")
                  : t("Create recurring income rule")}
              </h3>
              <IncomeRuleForm
                currency={currency}
                today={account.data.ownerToday}
                horses={
                  horses.data
                    .items as import("../features/finance/useFinancialForm").FinancialHorse[]
                }
                initialRule={editingRule}
                onPreview={previewRule}
                onCreate={async (body: IncomeRuleValues) => {
                  await runRuleCommand("POST", "/api/v1/income-rules", body);
                  setShowRuleForm(false);
                  setRuleNotice("Income rule created.");
                }}
                onRevise={async (body: IncomeRuleRevisionValues) => {
                  const path =
                    `/api/v1/income-rules/${encodeURIComponent(editingRule!.ruleId)}` as `/api/v1/income-rules/${string}`;
                  await runRuleCommand("PATCH", path, body);
                  setEditingRuleId(null);
                  setRuleNotice("Income rule revision saved.");
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setShowRuleForm(false);
                  setEditingRuleId(null);
                }}
              >
                {t("Cancel")}
              </button>
            </section>
          )}
          {stoppingRuleId && (
            <form
              aria-label={t("Stop income rule")}
              onSubmit={(event) => {
                event.preventDefault();
                const path =
                  `/api/v1/income-rules/${encodeURIComponent(stoppingRuleId)}/stop` as `/api/v1/income-rules/${string}/stop`;
                void runRuleCommand("POST", path, { lastDate })
                  .then(() => {
                    setStoppingRuleId(null);
                    setRuleNotice("Income rule stopped.");
                  })
                  .catch((reason) =>
                    setRuleError(
                      reason instanceof Error
                        ? reason
                        : "The income rule could not be stopped.",
                    ),
                  );
              }}
            >
              <label htmlFor="income-rule-last-date">
                {t("Last date (inclusive)")}
              </label>
              <input
                id="income-rule-last-date"
                type="date"
                min={through}
                value={lastDate}
                onChange={(event) => setLastDate(event.currentTarget.value)}
                required
              />
              {ruleError && <p role="alert">{t(ruleError)}</p>}
              <button type="submit">{t("Confirm stop")}</button>
              <button type="button" onClick={() => setStoppingRuleId(null)}>
                {t("Cancel stop")}
              </button>
            </form>
          )}
        </section>
      )}
      {account.isPending && (
        <p role="status">{t("Loading account settings…")}</p>
      )}
      {account.isError && (
        <div role="alert">
          <p>{t("Account settings could not be loaded.")}</p>
          <button type="button" onClick={() => void account.refetch()}>
            {t("Retry account")}
          </button>
        </div>
      )}
      {horses.isError && (
        <div role="alert">
          <p>{t("Horse names could not be loaded.")}</p>
          <button type="button" onClick={() => void horses.refetch()}>
            {t("Retry horses")}
          </button>
        </div>
      )}
      <section
        aria-labelledby="income-ledger-heading"
        data-testid={ledger.isSuccess ? "ledger-ready" : undefined}
      >
        <h2 id="income-ledger-heading">{t("This month’s income")}</h2>
        {!account.isError && ledger.isPending && (
          <p role="status">{t("Loading income…")}</p>
        )}
        {ledger.isError && (
          <div role="alert">
            <p>{errorText(ledger.error) || t("Income could not be loaded.")}</p>
            <button
              type="button"
              onClick={() =>
                void queryClient.resetQueries({
                  queryKey: keys?.income(queryRange),
                })
              }
            >
              {t("Retry income")}
            </button>
          </div>
        )}
        {!ledger.isPending && !ledger.isError && entries.length === 0 && (
          <p>{t("No income this month.")}</p>
        )}
        {entries.length > 0 && (
          <ol aria-label={t("Income ledger")}>
            {entries.map((item) => (
              <li key={item.id}>
                <h3>{item.source}</h3>
                <time dateTime={item.receivedDate}>
                  {new Date(`${item.receivedDate}T00:00:00`).toLocaleDateString(
                    locale,
                  )}
                </time>
                <p>{money(item.contributionMinor, currency, locale)}</p>
                <ul
                  aria-label={t("Allocations for {value0}", {
                    value0: item.source,
                  })}
                >
                  {item.allocations.map((allocation) => (
                    <li key={allocation.horseId}>
                      {horses.data?.items.find(
                        (horse) => horse.horseId === allocation.horseId,
                      )?.name ?? allocation.horseId}
                      : {money(allocation.amountMinor, currency, locale)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {ledger.hasNextPage && (
          <button
            type="button"
            disabled={ledger.isFetchingNextPage}
            onClick={() => void ledger.fetchNextPage()}
          >
            {ledger.isFetchingNextPage
              ? t("Loading older income…")
              : t("Load older income")}
          </button>
        )}
      </section>
    </section>
  );
}
