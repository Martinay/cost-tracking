import { editorShares } from "../features/finance/normalizeSplit";
import { formatRate } from "../features/driving/rate";
import { EntryPanel } from "../components/EntryPanel";
import { RecordCorrection } from "../features/finance/RecordCorrection";
import { ScheduleSummary } from "../features/recurrence/ScheduleSummary";
import { formatDate, formatMoney as money } from "../i18n/format";
import { useI18n } from "../i18n/I18nProvider";
import { PageHeading } from "../components/PageHeading";
import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import {
  type ApiCommand,
  type ApiRequestBody,
  type ApiResponse,
} from "../api/client";
import { createQueryKeys, invalidateSubjectLists } from "../api/queryKeys";
import { useAuthServices } from "../auth/AuthBoundary";
import {
  DrivingForm,
  type DrivingCommandBody,
  type DrivingPreview,
} from "../features/driving/DrivingForm";
import { ExpenseForm } from "../features/expenses/ExpenseForm";
import {
  ExpenseRuleForm,
  type ExpenseRuleCreateBody,
  type ExpenseRuleRevisionBody,
} from "../features/expenseRules/ExpenseRuleForm";
import {
  ExpenseOccurrenceEditor,
  type ExpenseOccurrenceAction,
  type ExpenseOccurrenceRequest,
  type ExpenseOccurrenceValues,
} from "../features/expenseRules/ExpenseOccurrenceEditor";
import type { FinancialPreview } from "../features/finance/useFinancialForm";

type LedgerPage = ApiResponse<"/api/v1/expenses", "get">;
type DrivingCommand = ApiCommand<"/api/v1/driving", "POST">;
type ExpenseRulePath =
  | "/api/v1/expense-rules"
  | `/api/v1/expense-rules/${string}`
  | `/api/v1/expense-rules/${string}/stop`;
type ExpenseRuleCommand = ApiCommand<ExpenseRulePath, "POST" | "PATCH">;
type ExpenseOccurrenceCommand = ApiCommand<
  `/api/v1/expense-rules/${string}/occurrences/${string}`,
  "PUT"
>;
type DrivingMutationResponse = ApiResponse<"/api/v1/driving", "post">;
type ExpenseRuleCreateResponse = ApiResponse<"/api/v1/expense-rules", "post">;
type ExpenseRuleRevisionResponse = ApiResponse<
  "/api/v1/expense-rules/{ruleId}",
  "patch"
>;
type ExpenseRuleStopResponse = ApiResponse<
  "/api/v1/expense-rules/{ruleId}/stop",
  "post"
>;
type ExpenseOccurrenceResponse = ApiResponse<
  "/api/v1/expense-rules/{ruleId}/occurrences/{scheduledDate}",
  "put"
>;
type LedgerAllocation = LedgerPage["items"][number]["allocations"][number];
interface PageParam {
  cursor: string | null;
  streamVersion: number | null;
}

type ExpenseRulePage = ApiResponse<"/api/v1/expense-rules", "get">;
type ExpenseRule = ExpenseRulePage["items"][number];
interface RulePageParam {
  cursor: string | null;
  streamVersion: number | null;
}

function splitFromAllocations(
  mode: string,
  allocations: LedgerAllocation[],
): ExpenseOccurrenceValues["split"] {
  return mode === "Custom"
    ? {
        mode: "Custom",
        shares: editorShares(allocations),
      }
    : { mode: "Equal", horseIds: allocations.map(({ horseId }) => horseId) };
}

function defaultsForDate(
  rule: ExpenseRule,
  scheduledDate: string,
): ExpenseOccurrenceValues {
  const revision = [...rule.revisions]
    .filter((item) => item.effectiveFrom <= scheduledDate)
    .sort((left, right) =>
      left.effectiveFrom.localeCompare(right.effectiveFrom),
    )
    .at(-1);
  const defaults = revision?.defaults ?? rule.defaults;
  return {
    amountMinor: defaults.amountMinor,
    category: defaults.category,
    description: defaults.description,
    split: splitFromAllocations(defaults.splitMode, defaults.allocations),
  };
}

export function ExpensesRoute() {
  const { t, locale, errorText } = useI18n();
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [recordingDriving, setRecordingDriving] = useState(false);
  const [drivingSaved, setDrivingSaved] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<
    string | null
  >(null);
  const [stoppingRuleId, setStoppingRuleId] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState("");
  const [ruleNotice, setRuleNotice] = useState("");
  const pendingDrivingCommand = useRef<DrivingCommand | null>(null);
  const pendingRuleCommand = useRef<ExpenseRuleCommand | null>(null);
  const pendingOccurrenceCommand = useRef<ExpenseOccurrenceCommand | null>(
    null,
  );
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
  const rules = useInfiniteQuery<
    ExpenseRulePage,
    Error,
    InfiniteData<ExpenseRulePage>,
    QueryKey,
    RulePageParam
  >({
    queryKey: keys?.expenseRules ?? ["expenseRules", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    initialPageParam: { cursor: null, streamVersion: null },
    queryFn: async ({ pageParam }) => {
      if (
        pageParam.cursor &&
        pageParam.streamVersion !== null &&
        subject &&
        apiClient.lastSeenVersion(subject) !== undefined &&
        apiClient.lastSeenVersion(subject) !== pageParam.streamVersion
      ) {
        throw new Error(
          "Expense rules changed while paging. Reload the rules to continue.",
        );
      }
      const query = new URLSearchParams({ limit: "100" });
      if (pageParam.cursor) query.set("cursor", pageParam.cursor);
      const path =
        `/api/v1/expense-rules?${query}` as `/api/v1/expense-rules?${string}`;
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
  const [selectedMonth, setSelectedMonth] = useState(
    () => new URLSearchParams(window.location.search).get("month") ?? "",
  );
  const [selectedHorse, setSelectedHorse] = useState(
    () => new URLSearchParams(window.location.search).get("horseId") ?? "",
  );
  const ownerToday =
    account.data?.ownerToday ?? new Date().toISOString().slice(0, 10);
  const month =
    /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(selectedMonth) &&
    selectedMonth <= ownerToday.slice(0, 7)
      ? selectedMonth
      : ownerToday.slice(0, 7);
  const endOfMonth = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const through = month === ownerToday.slice(0, 7) ? ownerToday : endOfMonth;
  const today = ownerToday;
  const from = `${month}-01`;
  const queryRange = { from, to: through };
  const ledger = useInfiniteQuery<
    LedgerPage,
    Error,
    InfiniteData<LedgerPage>,
    QueryKey,
    PageParam
  >({
    queryKey: keys?.expenses(queryRange, { horseId: selectedHorse }) ?? [
      "expenses",
      "unavailable",
    ],
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    initialPageParam: { cursor: null, streamVersion: null } as PageParam,
    queryFn: async ({ pageParam }) => {
      if (pageParam.cursor && pageParam.streamVersion !== null && subject) {
        const latest = apiClient.lastSeenVersion(subject);
        if (latest !== undefined && latest !== pageParam.streamVersion)
          throw new Error(
            "Expenses changed while paging. Reload the ledger to continue.",
          );
      }
      const params = new URLSearchParams({ from, to: through, limit: "50" });
      if (selectedHorse) params.set("horseId", selectedHorse);
      if (pageParam.cursor) params.set("cursor", pageParam.cursor);
      const path = `/api/v1/expenses?${params}` as `/api/v1/expenses?${string}`;
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
  const ruleEntries = rules.data?.pages.flatMap((page) => page.items) ?? [];
  const editingRule = editingRuleId
    ? ruleEntries.find((rule) => rule.ruleId === editingRuleId)
    : undefined;
  const selectedOccurrence = selectedOccurrenceId
    ? entries.find((item) => item.id === selectedOccurrenceId)
    : undefined;
  const selectedOccurrenceRule = selectedOccurrence?.ruleId
    ? ruleEntries.find((rule) => rule.ruleId === selectedOccurrence.ruleId)
    : undefined;
  const selectedScheduledDate =
    selectedOccurrence?.scheduledDate ?? selectedOccurrence?.expenseDate ?? "";
  const occurrenceDefaults = selectedOccurrenceRule
    ? defaultsForDate(selectedOccurrenceRule, selectedScheduledDate)
    : undefined;
  const occurrenceAction: ExpenseOccurrenceAction | null =
    selectedOccurrence?.occurrenceState === "Changed" ||
    selectedOccurrence?.occurrenceState === "Skipped"
      ? selectedOccurrence.occurrenceState
      : null;
  const occurrenceChanged: ExpenseOccurrenceValues | null =
    selectedOccurrence && occurrenceAction === "Changed"
      ? {
          amountMinor: selectedOccurrence.amountMinor,
          category: selectedOccurrence.category,
          description: selectedOccurrence.description,
          split: splitFromAllocations(
            selectedOccurrence.splitMode,
            selectedOccurrence.allocations,
          ),
        }
      : null;
  const currency = account.data?.currency ?? "EUR";
  const drivingMutation = useMutation({
    mutationFn: async (request: {
      body: DrivingCommandBody;
      streamVersion: number;
    }) => {
      if (!subject)
        throw new Error("Your session changed. Please sign in again.");
      const { body, streamVersion } = request;
      let command = pendingDrivingCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "POST" ||
        command.path !== "/api/v1/driving" ||
        command.body !== JSON.stringify(body) ||
        command.streamVersion !== streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "POST",
          path: "/api/v1/driving",
          body,
          streamVersion,
        });
        pendingDrivingCommand.current = command;
      }
      return (await apiClient.sendCommand(command)) as DrivingMutationResponse;
    },
    onSuccess: async (result) => {
      pendingDrivingCommand.current = null;
      if (subject) {
        apiClient.rememberVersion(subject, result.streamVersion);
        await Promise.all([
          invalidateSubjectLists(queryClient, subject, "expenses"),
          queryClient.invalidateQueries({ queryKey: ["account", subject] }),
          queryClient.invalidateQueries({ queryKey: ["history", subject] }),
          queryClient.invalidateQueries({ queryKey: ["report", subject] }),
        ]);
      }
      setRecordingDriving(false);
      setDrivingSaved(true);
    },
  });
  const invalidateRecurringData = async (streamVersion: number) => {
    if (!subject) return;
    apiClient.rememberVersion(subject, streamVersion);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys?.expenseRules }),
      invalidateSubjectLists(queryClient, subject, "expenses"),
      queryClient.invalidateQueries({ queryKey: ["account", subject] }),
      queryClient.invalidateQueries({ queryKey: ["history", subject] }),
      queryClient.invalidateQueries({ queryKey: ["report", subject] }),
    ]);
  };
  const createRuleMutation = useMutation({
    mutationFn: async (body: ExpenseRuleCreateBody) => {
      if (!subject)
        throw new Error("Your session changed. Please sign in again.");
      const path = "/api/v1/expense-rules" as const;
      const streamVersion =
        apiClient.lastSeenVersion(subject) ?? account.data?.streamVersion ?? 0;
      let command = pendingRuleCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "POST" ||
        command.path !== path ||
        command.body !== JSON.stringify(body) ||
        command.streamVersion !== streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "POST",
          path,
          body,
          streamVersion,
        });
        pendingRuleCommand.current = command;
      }
      return (await apiClient.sendCommand(
        command,
      )) as ExpenseRuleCreateResponse;
    },
    onSuccess: async (result) => {
      pendingRuleCommand.current = null;
      setShowRuleForm(false);
      setEditingRuleId(null);
      setRuleNotice("Expense rule created.");
      await invalidateRecurringData(result.streamVersion);
    },
  });
  const reviseRuleMutation = useMutation({
    mutationFn: async (request: {
      ruleId: string;
      body: ExpenseRuleRevisionBody;
    }) => {
      if (!subject)
        throw new Error("Your session changed. Please sign in again.");
      const path =
        `/api/v1/expense-rules/${encodeURIComponent(request.ruleId)}` as `/api/v1/expense-rules/${string}`;
      const { body } = request;
      const streamVersion =
        apiClient.lastSeenVersion(subject) ?? account.data?.streamVersion ?? 0;
      let command = pendingRuleCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "PATCH" ||
        command.path !== path ||
        command.body !== JSON.stringify(body) ||
        command.streamVersion !== streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "PATCH",
          path,
          body: body as ApiRequestBody<typeof path, "patch">,
          streamVersion,
        });
        pendingRuleCommand.current = command;
      }
      return (await apiClient.sendCommand(
        command,
      )) as ExpenseRuleRevisionResponse;
    },
    onSuccess: async (result) => {
      pendingRuleCommand.current = null;
      setShowRuleForm(false);
      setEditingRuleId(null);
      setRuleNotice("Expense rule revision saved.");
      await invalidateRecurringData(result.streamVersion);
    },
  });
  const stopRuleMutation = useMutation({
    mutationFn: async (request: { ruleId: string; lastDate: string }) => {
      if (!subject)
        throw new Error("Your session changed. Please sign in again.");
      const path =
        `/api/v1/expense-rules/${encodeURIComponent(request.ruleId)}/stop` as `/api/v1/expense-rules/${string}/stop`;
      const body = { lastDate: request.lastDate };
      const streamVersion =
        apiClient.lastSeenVersion(subject) ?? account.data?.streamVersion ?? 0;
      let command = pendingRuleCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "POST" ||
        command.path !== path ||
        command.body !== JSON.stringify(body) ||
        command.streamVersion !== streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "POST",
          path,
          body: body as ApiRequestBody<typeof path, "post">,
          streamVersion,
        });
        pendingRuleCommand.current = command;
      }
      return (await apiClient.sendCommand(command)) as ExpenseRuleStopResponse;
    },
    onSuccess: async (result) => {
      pendingRuleCommand.current = null;
      setStoppingRuleId(null);
      setLastDate("");
      setRuleNotice("Expense rule stopped.");
      await invalidateRecurringData(result.streamVersion);
    },
  });
  const occurrenceMutation = useMutation({
    mutationFn: async (request: {
      ruleId: string;
      scheduledDate: string;
      body: ExpenseOccurrenceRequest["values"];
    }) => {
      if (!subject)
        throw new Error("Your session changed. Please sign in again.");
      const path =
        `/api/v1/expense-rules/${encodeURIComponent(request.ruleId)}/occurrences/${encodeURIComponent(request.scheduledDate)}` as `/api/v1/expense-rules/${string}/occurrences/${string}`;
      const streamVersion =
        apiClient.lastSeenVersion(subject) ?? account.data?.streamVersion ?? 0;
      let command = pendingOccurrenceCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "PUT" ||
        command.path !== path ||
        command.body !== JSON.stringify(request.body) ||
        command.streamVersion !== streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "PUT",
          path,
          body: request.body as ApiRequestBody<typeof path, "put">,
          streamVersion,
        });
        pendingOccurrenceCommand.current = command;
      }
      return (await apiClient.sendCommand(
        command,
      )) as ExpenseOccurrenceResponse;
    },
    onSuccess: async (result) => {
      pendingOccurrenceCommand.current = null;
      setSelectedOccurrenceId(null);
      setRuleNotice("Expense occurrence updated.");
      await invalidateRecurringData(result.streamVersion);
    },
  });
  const [rangeStart, rangeEnd] = [
    new Date(`${from}T00:00:00Z`),
    new Date(`${through}T00:00:00Z`),
  ];

  return (
    <section aria-labelledby="expenses-heading">
      <PageHeading
        id="expenses-heading"
        title={t("Expenses")}
        description={t(
          "Keep every cost in view, from daily care to the unexpected.",
        )}
      />
      {canLoadProtectedData && (
        <button
          type="button"
          onClick={() => {
            setRecording((v) => !v);
            setShowRuleForm(false);
            setRecordingDriving(false);
          }}
        >
          {t("Record expense")}
        </button>
      )}
      {canLoadProtectedData && (
        <button
          type="button"
          onClick={() => {
            setDrivingSaved(false);
            setRecordingDriving((v) => !v);
            setRecording(false);
            setShowRuleForm(false);
          }}
        >
          {t("Record driving expense")}
        </button>
      )}
      {drivingSaved && <p role="status">{t("Driving expense saved.")}</p>}
      {/* Keep editors mounted during same-subject session recovery. */}
      {subject !== null && recording && (
        <EntryPanel onClose={() => setRecording(false)}>
          <ExpenseForm />
        </EntryPanel>
      )}
      {subject !== null && recordingDriving && account.data && horses.data && (
        <section aria-labelledby="driving-expense-heading">
          <h2 id="driving-expense-heading">{t("Record driving expense")}</h2>
          <EntryPanel onClose={() => setRecordingDriving(false)}>
            <DrivingForm
              draftScope={subject}
              horses={horses.data.items}
              today={account.data.ownerToday}
              currency={currency}
              savedRateMinorPerKm={account.data.drivingRateMinorPerKm ?? null}
              onPreview={async (request) =>
                (await apiClient.preview({
                  subject: subject!,
                  path: "/api/v1/previews/financial",
                  body: request,
                })) as DrivingPreview
              }
              onCommit={async (body, streamVersion) => {
                await drivingMutation.mutateAsync({ body, streamVersion });
              }}
            />
          </EntryPanel>
        </section>
      )}
      {subject !== null && (
        <section aria-labelledby="expense-rules-heading">
          <h2 id="expense-rules-heading">{t("Recurring expenses")}</h2>
          <button
            type="button"
            onClick={() => {
              setRuleNotice("");
              setEditingRuleId(null);
              setShowRuleForm((shown) => !shown);
              setRecording(false);
              setRecordingDriving(false);
            }}
          >
            {showRuleForm && !editingRuleId
              ? t("Cancel recurring rule")
              : t("Create recurring rule")}
          </button>
          {ruleNotice && <p role="status">{t(ruleNotice)}</p>}
          {rules.isPending && <p>{t("Loading recurring rules…")}</p>}
          {rules.isError && (
            <div role="alert">
              <p>
                {errorText(rules.error) ||
                  t("Recurring rules could not be loaded.")}
              </p>
              <button type="button" onClick={() => void rules.refetch()}>
                {t("Retry recurring rules")}
              </button>
            </div>
          )}
          {ruleEntries.length > 0 && (
            <ol aria-label={t("Recurring expense rules")}>
              {ruleEntries.map((rule) => (
                <li key={rule.ruleId}>
                  <h3>{rule.defaults.description || rule.defaults.category}</h3>
                  <p>
                    {money(rule.defaults.amountMinor, currency, locale)} ·{" "}
                    <ScheduleSummary
                      schedule={rule.schedule}
                      nextScheduledDate={rule.nextScheduledDate}
                      lastDate={rule.lastDate}
                      today={account.data?.ownerToday}
                    />
                  </p>
                  <ol
                    aria-label={t("Revisions for {value0}", {
                      value0:
                        rule.defaults.description || rule.defaults.category,
                    })}
                  >
                    {rule.revisions.map((revision) => (
                      <li key={revision.effectiveFrom}>
                        {t("Effective ")}
                        {formatDate(revision.effectiveFrom, locale)}:{" "}
                        {t(revision.schedule.cadence)},{" "}
                        {money(revision.defaults.amountMinor, currency, locale)}
                      </li>
                    ))}
                  </ol>
                  {rule.defaults.allocations.map((allocation) => (
                    <p key={allocation.horseId}>
                      <a
                        href={`/horses/${encodeURIComponent(allocation.horseId)}`}
                      >
                        {t("View history for")}{" "}
                        {horses.data?.items.find(
                          (horse) => horse.horseId === allocation.horseId,
                        )?.name ?? allocation.horseId}
                      </a>
                    </p>
                  ))}
                  {!rule.lastDate && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setRuleNotice("");
                          setEditingRuleId(rule.ruleId);
                          setShowRuleForm(true);
                          setRecording(false);
                          setRecordingDriving(false);
                        }}
                      >
                        {t("Revise recurring rule")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRuleNotice("");
                          setStoppingRuleId(rule.ruleId);
                          setLastDate("");
                        }}
                      >
                        {t("Stop recurring rule")}
                      </button>
                    </>
                  )}
                  {stoppingRuleId === rule.ruleId && (
                    <form
                      aria-label={t("Stop {value0}", {
                        value0:
                          rule.defaults.description || rule.defaults.category,
                      })}
                      noValidate
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!lastDate || lastDate < today) {
                          setRuleNotice(
                            "Choose an inclusive stop date that is today or later.",
                          );
                          return;
                        }
                        stopRuleMutation.mutate({
                          ruleId: rule.ruleId,
                          lastDate,
                        });
                      }}
                    >
                      <label htmlFor={`rule-last-date-${rule.ruleId}`}>
                        {t("Last date (inclusive)")}
                      </label>
                      <input
                        id={`rule-last-date-${rule.ruleId}`}
                        type="date"
                        min={today}
                        value={lastDate}
                        onChange={(event) =>
                          setLastDate(event.currentTarget.value)
                        }
                        required
                      />
                      <button
                        type="submit"
                        disabled={stopRuleMutation.isPending}
                      >
                        {t("Confirm stop")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStoppingRuleId(null)}
                      >
                        {t("Cancel")}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          )}
          {rules.hasNextPage && (
            <button
              type="button"
              disabled={rules.isFetchingNextPage}
              onClick={() => void rules.fetchNextPage()}
            >
              {rules.isFetchingNextPage
                ? t("Loading more recurring rules…")
                : t("Load more recurring rules")}
            </button>
          )}
          {showRuleForm && account.data && horses.data && (
            <section aria-labelledby="rule-form-heading">
              <h3 id="rule-form-heading">
                {editingRule
                  ? t("Revise recurring expense")
                  : t("New recurring expense")}
              </h3>
              {editingRuleId && !editingRule && (
                <p role="status">{t("Loading selected recurring rule…")}</p>
              )}
              {(!editingRuleId || editingRule) && (
                <EntryPanel
                  onClose={() => {
                    setShowRuleForm(false);
                    setEditingRuleId(null);
                  }}
                >
                  <ExpenseRuleForm
                    draftScope={subject}
                    today={account.data.ownerToday}
                    currency={currency}
                    horses={horses.data.items}
                    initialRule={editingRule}
                    onPreview={async (
                      values,
                      exampleSchedule,
                      effectiveFrom,
                    ) => {
                      const result = (await apiClient.preview({
                        subject: subject!,
                        path: "/api/v1/previews/financial",
                        body: {
                          kind: "Expense",
                          exampleOccurrence: true,
                          exampleSchedule,
                          effectiveFrom,
                          values,
                        },
                      })) as FinancialPreview;
                      apiClient.rememberVersion(subject!, result.streamVersion);
                      return result;
                    }}
                    onCreate={(body) =>
                      createRuleMutation.mutateAsync(body).then(() => undefined)
                    }
                    onRevise={(body) =>
                      editingRule
                        ? reviseRuleMutation
                            .mutateAsync({ ruleId: editingRule.ruleId, body })
                            .then(() => undefined)
                        : Promise.reject(
                            new Error(
                              "The selected recurring rule is no longer available.",
                            ),
                          )
                    }
                  />
                </EntryPanel>
              )}
            </section>
          )}
          {(createRuleMutation.isError ||
            reviseRuleMutation.isError ||
            stopRuleMutation.isError) && (
            <p role="alert">
              {errorText(
                [
                  createRuleMutation.error,
                  reviseRuleMutation.error,
                  stopRuleMutation.error,
                ].find((error) => error instanceof Error),
                "The recurring rule could not be saved.",
              )}
            </p>
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
      <section aria-labelledby="expenses-ledger-heading">
        <h2 id="expenses-ledger-heading">{t("Expenses in selected month")}</h2>
        <label>
          {t("Ledger month")}
          <input
            type="month"
            value={month}
            max={ownerToday.slice(0, 7)}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
        </label>
        <label htmlFor="ledger-horse-filter">{t("Horse filter")}</label>
        <select
          id="ledger-horse-filter"
          value={selectedHorse}
          onChange={(e) => setSelectedHorse(e.target.value)}
        >
          <option value="">{t("All horses")}</option>
          {horses.data?.items.map((h) => (
            <option key={h.horseId} value={h.horseId}>
              {h.name}
            </option>
          ))}
        </select>
        {!account.isError && ledger.isPending && (
          <p role="status">{t("Loading expenses…")}</p>
        )}
        {ledger.isError && (
          <div role="alert">
            <p>
              {errorText(ledger.error) || t("Expenses could not be loaded.")}
            </p>
            <button
              type="button"
              onClick={() =>
                void queryClient.resetQueries({
                  queryKey: keys?.expenses(queryRange, {
                    horseId: selectedHorse,
                  }),
                })
              }
            >
              {t("Retry expenses")}
            </button>
          </div>
        )}
        {!ledger.isPending && !ledger.isError && entries.length === 0 && (
          <p>{t("No expenses this month.")}</p>
        )}
        {entries.length > 0 && (
          <ol aria-label={t("Expense ledger")}>
            {entries.map((item) => (
              <li key={item.id}>
                <h3>{item.description || item.category}</h3>
                {item.origin === "OneTime" && (
                  <RecordCorrection
                    kind="Expense"
                    item={item}
                    horses={horses.data?.items ?? []}
                    currency={currency}
                  />
                )}
                <time dateTime={item.expenseDate}>
                  {formatDate(item.expenseDate, locale)}
                </time>
                <p>
                  {item.category} ·{" "}
                  {money(item.contributionMinor, currency, locale)}
                </p>
                {item.origin === "Recurring" && item.scheduledDate && (
                  <>
                    <p>
                      {t("Scheduled amount: ")}
                      {money(item.amountMinor, currency, locale)}
                      {t(". Amount counted: ")}
                      {money(item.contributionMinor, currency, locale)}.
                    </p>
                    <p>
                      {t("Payment state:")}{" "}
                      {item.occurrenceState === "Virtual"
                        ? t("Scheduled")
                        : t(item.occurrenceState)}
                    </p>
                    {item.ruleId && (
                      <>
                        <button
                          type="button"
                          onClick={() => setSelectedOccurrenceId(item.id)}
                        >
                          {t("Change occurrence ")}
                          {formatDate(item.scheduledDate, locale)}
                        </button>
                        {item.skipped ? (
                          <button
                            type="button"
                            onClick={() => setSelectedOccurrenceId(item.id)}
                          >
                            {t("Restore occurrence ")}
                            {formatDate(item.scheduledDate, locale)}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedOccurrenceId(item.id)}
                          >
                            {t("Skip occurrence ")}
                            {formatDate(item.scheduledDate, locale)}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
                {item.driving && (
                  <p>
                    {item.driving.kilometers} {t("km at")}{" "}
                    {formatRate(item.driving.rateMinorPerKm, currency, locale)}{" "}
                    {t("per km")}
                  </p>
                )}
                <ul
                  aria-label={t("Allocations for {value0}", {
                    value0: item.description || item.category,
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
        {selectedOccurrence &&
          selectedOccurrenceRule &&
          occurrenceDefaults &&
          selectedOccurrence.ruleId && (
            <section aria-labelledby="occurrence-editor-heading">
              <h3 id="occurrence-editor-heading">
                {t("Edit scheduled expense on ")}
                {formatDate(selectedScheduledDate, locale)}
              </h3>
              <ExpenseOccurrenceEditor
                ruleId={selectedOccurrence.ruleId}
                scheduledDate={selectedScheduledDate}
                currency={currency}
                defaults={occurrenceDefaults}
                horses={horses.data?.items ?? []}
                current={{
                  action: occurrenceAction,
                  changed: occurrenceChanged,
                }}
                onPreview={async (request) => {
                  const result = (await apiClient.preview({
                    subject: subject!,
                    path: "/api/v1/previews/financial",
                    body: request,
                  })) as FinancialPreview;
                  apiClient.rememberVersion(subject!, result.streamVersion);
                  return result;
                }}
                onSave={(body) =>
                  occurrenceMutation
                    .mutateAsync({
                      ruleId: selectedOccurrence.ruleId!,
                      scheduledDate: selectedScheduledDate,
                      body,
                    })
                    .then(() => undefined)
                }
                error={
                  occurrenceMutation.isError
                    ? occurrenceMutation.error instanceof Error
                      ? occurrenceMutation.error.message
                      : "The occurrence could not be saved."
                    : undefined
                }
              />
              <button
                type="button"
                onClick={() => setSelectedOccurrenceId(null)}
              >
                {t("Close occurrence editor")}
              </button>
            </section>
          )}
        {occurrenceMutation.isError && !selectedOccurrence && (
          <p role="alert">
            {occurrenceMutation.error instanceof Error
              ? errorText(occurrenceMutation.error)
              : t("The occurrence could not be saved.")}
          </p>
        )}
        {ledger.hasNextPage && (
          <button
            type="button"
            disabled={ledger.isFetchingNextPage}
            onClick={() => void ledger.fetchNextPage()}
          >
            {ledger.isFetchingNextPage
              ? t("Loading older expenses…")
              : t("Load older expenses")}
          </button>
        )}
        <span className="sr-only">
          {t("Ledger period ")}
          {formatDate(rangeStart.toISOString().slice(0, 10), locale)}{" "}
          {t("through")}{" "}
          {formatDate(rangeEnd.toISOString().slice(0, 10), locale)}.
        </span>
      </section>
    </section>
  );
}
