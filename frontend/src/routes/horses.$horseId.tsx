import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import { ApiError, type ApiCommand, type ApiResponse } from "../api/client";
import { createQueryKeys, invalidateSubjectLists } from "../api/queryKeys";
import { useAuthServices } from "../auth/AuthBoundary";
import {
  HorseForm,
  type HorseFormValue,
  type HorseStatus,
} from "../features/horses/HorseForm";

type HistoryPage = ApiResponse<"/api/v1/history", "get">;
interface HistoryPageParam {
  cursor: string | null;
  streamVersion: number | null;
}
interface ReportPageParam {
  cursor: string | null;
  streamVersion: number | null;
  asOfDate: string | null;
}
type LifetimePage = ApiResponse<"/api/v1/reports/lifetime", "get">;

function requestError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404)
    return "Horse not found.";
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : "The horse could not be loaded or saved. Please try again.";
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export interface HorseDetailRouteProps {
  horseId: string;
}

export function HorseDetailRoute({ horseId }: HorseDetailRouteProps) {
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [showAffectedRules, setShowAffectedRules] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<
    "history" | "activity"
  >("history");
  const pendingDetailsCommand = useRef<ApiCommand<
    `/api/v1/horses/${string}`,
    "PATCH"
  > | null>(null);
  const pendingStatusCommand = useRef<ApiCommand<
    `/api/v1/horses/${string}/status`,
    "PUT"
  > | null>(null);
  const keys = subject ? createQueryKeys(subject) : null;
  const horse = useQuery({
    queryKey: keys?.horse(horseId) ?? ["horse", "unavailable", horseId],
    enabled: canLoadProtectedData && subject !== null,
    retry: (failureCount, error) =>
      error instanceof ApiError && error.status === 404
        ? false
        : failureCount < 3,
    queryFn: async () => {
      const result = await apiClient.get({
        subject: subject!,
        path: `/api/v1/horses/${encodeURIComponent(horseId)}`,
      });
      apiClient.rememberVersion(subject!, result.streamVersion);
      return result;
    },
  });
  const history = useInfiniteQuery<
    HistoryPage,
    Error,
    InfiniteData<HistoryPage>,
    QueryKey,
    HistoryPageParam
  >({
    queryKey: keys?.history({
      horseId,
      streamVersion: horse.data?.streamVersion ?? 0,
    }) ?? ["history", "unavailable"],
    enabled:
      canLoadProtectedData && subject !== null && horse.data !== undefined,
    initialPageParam: { cursor: null, streamVersion: null } as HistoryPageParam,
    queryFn: async ({ pageParam }): Promise<HistoryPage> => {
      let cursor = pageParam.cursor;
      if (cursor && pageParam.streamVersion !== null) {
        const currentVersion = apiClient.lastSeenVersion(subject!);
        if (
          currentVersion !== undefined &&
          currentVersion !== pageParam.streamVersion
        ) {
          throw new Error(
            "History changed while you were paging. Reload history to continue.",
          );
        }
        cursor =
          apiClient.cursorForVersion(
            cursor,
            pageParam.streamVersion,
            subject!,
          ) ?? null;
      }
      const query = new URLSearchParams({ horseId });
      if (cursor) query.set("cursor", cursor);
      const page = await apiClient.get({
        subject: subject!,
        path: `/api/v1/history?${query}`,
      });
      apiClient.rememberVersion(subject!, page.streamVersion);
      return page;
    },
    getNextPageParam: (page): HistoryPageParam | undefined =>
      page.nextCursor
        ? { cursor: page.nextCursor, streamVersion: page.streamVersion }
        : undefined,
  });
  const account = useQuery({
    queryKey: keys?.account ?? ["account", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    queryFn: async () =>
      await apiClient.get({
        subject: subject!,
        path: "/api/v1/account",
      }),
  });
  const expenseRules = useQuery({
    queryKey: keys?.expenseRules ?? ["expenseRules", "unavailable"],
    enabled:
      canLoadProtectedData &&
      subject !== null &&
      (showAffectedRules ||
        horse.data?.status === "Retired" ||
        horse.data?.status === "Sold"),
    queryFn: async () =>
      await apiClient.get({
        subject: subject!,
        path: "/api/v1/expense-rules?limit=100",
      }),
  });
  const month =
    account.data?.ownerToday?.slice(0, 7) ??
    new Date().toISOString().slice(0, 7);
  const today =
    account.data?.ownerToday ?? new Date().toISOString().slice(0, 10);
  const monthlyKey = keys?.report("monthly-pnl", { month, horseId }) ?? [
    "report",
    "unavailable",
    "monthly-pnl",
    month,
    horseId,
  ];
  const monthly = useQuery({
    queryKey: monthlyKey,
    enabled:
      canLoadProtectedData &&
      subject !== null &&
      horse.data !== undefined &&
      account.data !== undefined,
    queryFn: async () => {
      const query = new URLSearchParams({ month, horseId });
      return await apiClient.get({
        subject: subject!,
        path: `/api/v1/reports/monthly-pnl?${query}`,
      });
    },
  });
  const lifetimeKey = keys?.report("lifetime", { horseId }) ?? [
    "report",
    "unavailable",
    "lifetime",
    horseId,
  ];
  const lifetime = useInfiniteQuery<
    LifetimePage,
    Error,
    InfiniteData<LifetimePage>,
    QueryKey,
    ReportPageParam
  >({
    queryKey: lifetimeKey,
    enabled:
      canLoadProtectedData &&
      subject !== null &&
      horse.data !== undefined &&
      account.data !== undefined,
    initialPageParam: { cursor: null, streamVersion: null, asOfDate: null },
    queryFn: async ({ pageParam }) => {
      if (pageParam.cursor && pageParam.streamVersion !== null) {
        const latest = apiClient.lastSeenVersion(subject!);
        if (latest !== undefined && latest !== pageParam.streamVersion)
          throw new Error(
            "Report data changed while loading. Restart the lifetime report.",
          );
      }
      const query = new URLSearchParams({ limit: "100", horseId });
      if (pageParam.cursor) query.set("cursor", pageParam.cursor);
      const page = await apiClient.get({
        subject: subject!,
        path: `/api/v1/reports/lifetime?${query}`,
      });
      if (pageParam.asOfDate && page.asOfDate !== pageParam.asOfDate)
        throw new Error(
          "The report date changed while loading. Restart the lifetime report.",
        );
      if (
        pageParam.streamVersion !== null &&
        page.streamVersion !== pageParam.streamVersion
      )
        throw new Error(
          "Report version changed while loading. Restart the lifetime report.",
        );
      apiClient.rememberVersion(subject!, page.streamVersion);
      return page;
    },
    getNextPageParam: (page) =>
      !page.complete && page.nextCursor
        ? {
            cursor: page.nextCursor,
            streamVersion: page.streamVersion,
            asOfDate: page.asOfDate,
          }
        : undefined,
  });
  const activityFrom = `${month}-01`;
  const activityKey = keys?.report("activity", {
    from: activityFrom,
    to: today,
    horseId,
  }) ?? ["report", "unavailable", "activity", horseId];
  const activity = useQuery({
    queryKey: activityKey,
    enabled:
      canLoadProtectedData &&
      subject !== null &&
      account.data !== undefined &&
      activeDetailTab === "activity",
    queryFn: async () => {
      const query = new URLSearchParams({
        from: activityFrom,
        to: today,
        horseId,
      });
      return await apiClient.get({
        subject: subject!,
        path: `/api/v1/reports/activity?${query}`,
      });
    },
  });
  const updateDetails = useMutation({
    mutationFn: async (value: HorseFormValue) => {
      if (!subject || !horse.data)
        throw new Error("Horse details are still loading.");
      const path = `/api/v1/horses/${encodeURIComponent(horseId)}` as const;
      const body = {
        name: value.name,
        breed: value.breed,
        dateOfBirth: value.dateOfBirth,
      };
      let command = pendingDetailsCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "PATCH" ||
        command.path !== path ||
        command.body !== JSON.stringify(body) ||
        command.streamVersion !== horse.data.streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "PATCH",
          path,
          body,
          streamVersion: horse.data.streamVersion,
        });
        pendingDetailsCommand.current = command;
      }
      return await apiClient.sendCommand(command);
    },
    onSuccess: async (result) => {
      pendingDetailsCommand.current = null;
      if (subject) apiClient.rememberVersion(subject, result.streamVersion);
      queryClient.setQueryData(keys!.horse(horseId), result);
      setNotice("Horse details saved.");
      if (subject) await invalidateSubjectLists(queryClient, subject, "horses");
      if (subject) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: keys?.expenseRules }),
          invalidateSubjectLists(queryClient, subject, "expenses"),
          queryClient.invalidateQueries({ queryKey: ["report", subject] }),
        ]);
      }
      if (subject)
        await queryClient.invalidateQueries({ queryKey: ["history", subject] });
    },
  });
  const updateStatus = useMutation({
    mutationFn: async (status: HorseStatus) => {
      if (!subject || !horse.data)
        throw new Error("Horse details are still loading.");
      const path =
        `/api/v1/horses/${encodeURIComponent(horseId)}/status` as const;
      const body = { status };
      let command = pendingStatusCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "PUT" ||
        command.path !== path ||
        command.body !== JSON.stringify(body) ||
        command.streamVersion !== horse.data.streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "PUT",
          path,
          body,
          streamVersion: horse.data.streamVersion,
        });
        pendingStatusCommand.current = command;
      }
      return await apiClient.sendCommand(command);
    },
    onSuccess: async (result) => {
      pendingStatusCommand.current = null;
      if (subject) apiClient.rememberVersion(subject, result.streamVersion);
      queryClient.setQueryData(keys!.horse(horseId), result);
      setNotice("Horse status updated.");
      setShowAffectedRules(true);
      if (subject) await invalidateSubjectLists(queryClient, subject, "horses");
      if (subject) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: keys?.expenseRules }),
          invalidateSubjectLists(queryClient, subject, "expenses"),
          queryClient.invalidateQueries({ queryKey: ["report", subject] }),
          queryClient.invalidateQueries({ queryKey: ["history", subject] }),
        ]);
      }
    },
  });

  if (horse.isPending)
    return (
      <section aria-busy="true">
        <h1>Horse details</h1>
        <p role="status">Loading horse…</p>
      </section>
    );
  if (horse.isError)
    return (
      <section>
        <h1>Horse details</h1>
        <p role="alert">{requestError(horse.error)}</p>
        <a href="/horses">Back to horses</a>
      </section>
    );
  const item = horse.data;
  const affectedExpenseRules = (expenseRules.data?.items ?? []).filter((rule) =>
    [
      rule.defaults,
      ...rule.revisions.map((revision) => revision.defaults),
    ].some((defaults) =>
      defaults.allocations.some((allocation) => allocation.horseId === horseId),
    ),
  );
  return (
    <section aria-labelledby="horse-heading">
      <h1 id="horse-heading">{item.name}</h1>
      {notice && <p role="status">{notice}</p>}
      <HorseForm
        mode="edit"
        initialValue={item}
        isSaving={updateDetails.isPending}
        errorMessage={
          updateDetails.isError ? requestError(updateDetails.error) : undefined
        }
        onSubmit={(value) =>
          updateDetails.mutateAsync(value).then(() => undefined)
        }
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const field = event.currentTarget.elements.namedItem(
            "horseStatus",
          ) as HTMLSelectElement;
          updateStatus.mutate(field.value as HorseStatus);
        }}
      >
        <label htmlFor="horse-status">Horse status</label>
        <select
          id="horse-status"
          name="horseStatus"
          defaultValue={item.status}
          disabled={updateStatus.isPending}
        >
          <option value="Active">Active</option>
          <option value="Leased">Leased</option>
          <option value="Retired">Retired</option>
          <option value="Sold">Sold</option>
        </select>
        <button type="submit" disabled={updateStatus.isPending}>
          Update status
        </button>
        {updateStatus.isError && (
          <p role="alert">{requestError(updateStatus.error)}</p>
        )}
      </form>
      <section aria-labelledby="horse-recurring-expenses-heading">
        <h2 id="horse-recurring-expenses-heading">
          Affected recurring expenses
        </h2>
        {!showAffectedRules &&
          item.status !== "Retired" &&
          item.status !== "Sold" && (
            <p>
              Update the horse status to review any affected recurring
              obligations.
            </p>
          )}
        {expenseRules.isPending && <p>Loading recurring expenses…</p>}
        {expenseRules.isError && (
          <div role="alert">
            <p>{requestError(expenseRules.error)}</p>
            <button type="button" onClick={() => void expenseRules.refetch()}>
              Retry recurring expenses
            </button>
          </div>
        )}
        {(showAffectedRules ||
          item.status === "Retired" ||
          item.status === "Sold") &&
          !expenseRules.isPending &&
          !expenseRules.isError &&
          affectedExpenseRules.length === 0 && (
            <p>No recurring expenses involve this horse.</p>
          )}
        {affectedExpenseRules.length > 0 && (
          <ul aria-label="Affected recurring expense rules">
            {affectedExpenseRules.map((rule) => (
              <li key={rule.ruleId}>
                <h3>{rule.defaults.description || rule.defaults.category}</h3>
                <p>
                  {rule.schedule.cadence} from {rule.startDate}; inclusive
                  through{" "}
                  {rule.lastDate ?? rule.schedule.endDate ?? "no end date"}.
                </p>
                <p>
                  {money(
                    rule.defaults.amountMinor,
                    account.data?.currency ?? "EUR",
                  )}{" "}
                  · {rule.defaults.category}
                </p>
                <a href="/expenses">Review scheduled expenses and history</a>
              </li>
            ))}
          </ul>
        )}
        {(item.status === "Retired" || item.status === "Sold") &&
          affectedExpenseRules.length > 0 && (
            <p>
              Existing recurring expense obligations remain scheduled after this
              horse became {item.status.toLowerCase()}.
            </p>
          )}
      </section>
      <section aria-label="Financial summary">
        <h2>Financial summary</h2>
        <h3>Monthly profit and loss for {month}</h3>
        {monthly.isPending && <p role="status">Loading monthly report…</p>}
        {monthly.isError && <p role="alert">{requestError(monthly.error)}</p>}
        {monthly.data &&
          Array.isArray(monthly.data.items) &&
          monthly.data.currency && (
            <dl>
              <dt>Monthly income</dt>
              <dd>
                {money(
                  monthly.data.items.find((row) => row.horseId === horseId)
                    ?.incomeMinor ?? 0,
                  monthly.data.currency,
                )}
              </dd>
              <dt>Monthly expenses</dt>
              <dd>
                {money(
                  monthly.data.items.find((row) => row.horseId === horseId)
                    ?.expenseMinor ?? 0,
                  monthly.data.currency,
                )}
              </dd>
              <dt>Monthly net</dt>
              <dd>
                {money(
                  monthly.data.items.find((row) => row.horseId === horseId)
                    ?.netMinor ?? 0,
                  monthly.data.currency,
                )}
              </dd>
            </dl>
          )}
        <h3>Lifetime</h3>
        {lifetime.isPending && <p role="status">Loading lifetime report…</p>}
        {lifetime.isError && (
          <div role="alert">
            <p>{requestError(lifetime.error)}</p>
            <button
              type="button"
              onClick={() =>
                void queryClient.resetQueries({ queryKey: lifetimeKey })
              }
            >
              Restart lifetime report
            </button>
          </div>
        )}
        {lifetime.data?.pages[0]?.asOfDate && (
          <p>Through {lifetime.data.pages[0].asOfDate}</p>
        )}
        {lifetime.data &&
          lifetime.data.pages.at(-1)?.complete &&
          lifetime.data.pages[0]?.currency && (
            <dl>
              <dt>Lifetime income</dt>
              <dd>
                {money(
                  lifetime.data.pages
                    .flatMap((page) =>
                      Array.isArray(page.items) ? page.items : [],
                    )
                    .filter((row) => row.horseId === horseId)
                    .at(-1)?.incomeMinor ?? 0,
                  lifetime.data.pages[0].currency,
                )}
              </dd>
              <dt>Lifetime expenses</dt>
              <dd>
                {money(
                  lifetime.data.pages
                    .flatMap((page) =>
                      Array.isArray(page.items) ? page.items : [],
                    )
                    .filter((row) => row.horseId === horseId)
                    .at(-1)?.expenseMinor ?? 0,
                  lifetime.data.pages[0].currency,
                )}
              </dd>
              <dt>Lifetime net</dt>
              <dd>
                {money(
                  lifetime.data.pages
                    .flatMap((page) =>
                      Array.isArray(page.items) ? page.items : [],
                    )
                    .filter((row) => row.horseId === horseId)
                    .at(-1)?.netMinor ?? 0,
                  lifetime.data.pages[0].currency,
                )}
              </dd>
            </dl>
          )}
        {lifetime.data && !lifetime.data.pages.at(-1)?.complete && (
          <p>
            Lifetime totals are incomplete. Totals appear after every batch has
            loaded.
          </p>
        )}
        {lifetime.hasNextPage && !lifetime.isError && (
          <button
            type="button"
            disabled={lifetime.isFetchingNextPage}
            onClick={() => void lifetime.fetchNextPage()}
          >
            Load remaining lifetime results
          </button>
        )}
      </section>
      <div role="tablist" aria-label="Horse details">
        <button
          id="horse-history-tab"
          type="button"
          role="tab"
          aria-selected={activeDetailTab === "history"}
          aria-controls="horse-history-panel"
          onClick={() => setActiveDetailTab("history")}
        >
          History
        </button>
        <button
          id="horse-activity-tab"
          type="button"
          role="tab"
          aria-selected={activeDetailTab === "activity"}
          aria-controls="horse-activity-panel"
          onClick={() => setActiveDetailTab("activity")}
        >
          Activity
        </button>
      </div>
      <section
        id="horse-history-panel"
        role="tabpanel"
        aria-labelledby="horse-history-tab"
        hidden={activeDetailTab !== "history"}
      >
        <h2 id="horse-history-heading">History</h2>
        {history.isPending && <p role="status">Loading history…</p>}
        {history.isError && (
          <div role="alert">
            <p>{requestError(history.error)}</p>
            <button type="button" onClick={() => void history.refetch()}>
              Reload history
            </button>
          </div>
        )}
        {history.data &&
          history.data.pages.flatMap((page) => page.items).length === 0 && (
            <p>No history yet.</p>
          )}
        {history.data &&
          history.data.pages.flatMap((page) => page.items).length > 0 && (
            <ol aria-label="Horse history">
              {history.data.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <li key={item.eventId}>
                    <p>{item.summary}</p>
                    <time dateTime={item.occurredAt}>
                      {new Date(item.occurredAt).toLocaleString()}
                    </time>
                  </li>
                ))}
            </ol>
          )}
        {history.hasNextPage && (
          <button
            type="button"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {history.isFetchingNextPage
              ? "Loading older history…"
              : "Load older history"}
          </button>
        )}
      </section>
      <section
        id="horse-activity-panel"
        role="tabpanel"
        aria-labelledby="horse-activity-tab"
        hidden={activeDetailTab !== "activity"}
      >
        <h2 id="horse-activity-heading">Activity</h2>
        {activity.isPending && <p role="status">Loading activity…</p>}
        {activity.isError && (
          <div role="alert">
            <p>{requestError(activity.error)}</p>
            <button type="button" onClick={() => void activity.refetch()}>
              Reload activity
            </button>
          </div>
        )}
        {activity.data && activity.data.items.length === 0 && (
          <p>No activity recorded this month.</p>
        )}
        {activity.data && activity.data.items.length > 0 && (
          <ul aria-label="Horse activity summary">
            {activity.data.items.map((row) => (
              <li key={row.taskType}>
                {row.taskType.replace(/([a-z])([A-Z])/g, "$1 $2")}: {row.count}{" "}
                tasks, {row.minutes} minutes
              </li>
            ))}
          </ul>
        )}
      </section>
      <a href="/horses">Back to horses</a>
    </section>
  );
}
