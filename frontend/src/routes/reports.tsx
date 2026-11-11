import { formatDate } from "../i18n/format";
import { useI18n } from "../i18n/I18nProvider";
import { PageHeading } from "../components/PageHeading";
import { useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import { createQueryKeys } from "../api/queryKeys";
import { useAuthServices } from "../auth/AuthBoundary";
import {
  LifetimeTable,
  type LifetimeReportPage,
} from "../features/reports/LifetimeTable";
import { BreakdownTable } from "../features/reports/BreakdownTable";
import { ActivitySummary } from "../features/reports/ActivitySummary";
import { PnlTable } from "../features/reports/PnlTable";
interface LifetimePageParam {
  cursor: string | null;
  streamVersion: number | null;
  asOfDate: string | null;
}

export function ReportsRoute() {
  const { t, locale, errorText } = useI18n();
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const keys = subject ? createQueryKeys(subject) : null;
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedHorseId, setSelectedHorseId] = useState("");
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
  const month =
    selectedMonth ??
    account.data?.ownerToday.slice(0, 7) ??
    new Date().toISOString().slice(0, 7);
  const from = `${month}-01`;
  const to =
    month === (account.data?.ownerToday.slice(0, 7) ?? month)
      ? (account.data?.ownerToday ?? `${month}-31`)
      : monthEnd(month);
  const monthlyKey = keys?.report("monthly-pnl", {
    month,
    horseId: selectedHorseId,
  }) ?? ["report", "unavailable", "monthly-pnl", month, selectedHorseId];
  const monthly = useQuery({
    queryKey: monthlyKey,
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    queryFn: async () => {
      const query = new URLSearchParams({ month });
      if (selectedHorseId) query.set("horseId", selectedHorseId);
      const path: `/api/v1/reports/monthly-pnl?${string}` = `/api/v1/reports/monthly-pnl?${query}`;
      const result = await apiClient.get({
        subject: subject!,
        path,
      });
      apiClient.rememberVersion(subject!, result.streamVersion);
      return result;
    },
  });
  const breakdownQuery = (kind: "expense" | "income") => {
    const query = new URLSearchParams({ from, to, kind });
    if (selectedHorseId) query.set("horseId", selectedHorseId);
    return query;
  };
  const expenseBreakdown = useQuery({
    queryKey: keys?.report("breakdown", {
      from,
      to,
      kind: "expense",
      horseId: selectedHorseId,
    }) ?? [
      "report",
      "unavailable",
      "breakdown",
      from,
      to,
      "expense",
      selectedHorseId,
    ],
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    queryFn: async () => {
      const path =
        `/api/v1/reports/breakdown?${breakdownQuery("expense")}` as `/api/v1/reports/breakdown?${string}`;
      return await apiClient.get({
        subject: subject!,
        path,
      });
    },
  });
  const incomeBreakdown = useQuery({
    queryKey: keys?.report("breakdown", {
      from,
      to,
      kind: "income",
      horseId: selectedHorseId,
    }) ?? [
      "report",
      "unavailable",
      "breakdown",
      from,
      to,
      "income",
      selectedHorseId,
    ],
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    queryFn: async () => {
      const path =
        `/api/v1/reports/breakdown?${breakdownQuery("income")}` as `/api/v1/reports/breakdown?${string}`;
      return await apiClient.get({
        subject: subject!,
        path,
      });
    },
  });
  const activityQuery = new URLSearchParams({ from, to });
  if (selectedHorseId) activityQuery.set("horseId", selectedHorseId);
  const activity = useQuery({
    queryKey: keys?.report("activity", {
      from,
      to,
      horseId: selectedHorseId,
    }) ?? ["report", "unavailable", "activity", from, to, selectedHorseId],
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    queryFn: async () => {
      const path =
        `/api/v1/reports/activity?${activityQuery}` as `/api/v1/reports/activity?${string}`;
      return await apiClient.get({
        subject: subject!,
        path,
      });
    },
  });
  const lifetimeKey = keys?.report("lifetime") ?? [
    "report",
    "unavailable",
    "lifetime",
  ];
  const lifetime = useInfiniteQuery<
    LifetimeReportPage,
    Error,
    InfiniteData<LifetimeReportPage>,
    QueryKey,
    LifetimePageParam
  >({
    queryKey: lifetimeKey,
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    initialPageParam: { cursor: null, streamVersion: null, asOfDate: null },
    queryFn: async ({ pageParam }) => {
      if (pageParam.cursor && pageParam.streamVersion !== null && subject) {
        const latest = apiClient.lastSeenVersion(subject);
        if (latest !== undefined && latest !== pageParam.streamVersion)
          throw new Error(
            "Report data changed while loading. Restart the lifetime report.",
          );
      }
      const query = new URLSearchParams({ limit: "100" });
      if (pageParam.cursor) query.set("cursor", pageParam.cursor);
      const path =
        `/api/v1/reports/lifetime?${query}` as `/api/v1/reports/lifetime?${string}`;
      const page = await apiClient.get({
        subject: subject!,
        path,
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
  const horseNames = new Map(
    (horses.data?.items ?? []).map((horse) => [
      horse.horseId,
      horse.status === "Active" || horse.status === "Leased"
        ? horse.name
        : `${horse.name} (${t(horse.status)})`,
    ]),
  );
  const pages = lifetime.data?.pages ?? [];
  const isComplete = pages.at(-1)?.complete === true;

  return (
    <section aria-labelledby="reports-heading">
      <PageHeading
        id="reports-heading"
        title={t("Financial reports")}
        description={t(
          "See the bigger picture, one horse and one month at a time.",
        )}
      />
      <p>
        <a
          href={`/expenses?month=${month}&horseId=${encodeURIComponent(selectedHorseId)}`}
        >
          {t("View expenses for this month")}
        </a>{" "}
        ·{" "}
        <a
          href={`/income?month=${month}&horseId=${encodeURIComponent(selectedHorseId)}`}
        >
          {t("View income for this month")}
        </a>
      </p>
      <section
        aria-labelledby="monthly-heading"
        data-testid={monthly.isSuccess ? "report-ready" : undefined}
      >
        <h2 id="monthly-heading">{t("Monthly profit and loss")}</h2>
        <label htmlFor="report-month">{t("Report month")}</label>
        <input
          id="report-month"
          type="month"
          value={month}
          onChange={(event) => setSelectedMonth(event.currentTarget.value)}
        />
        <label htmlFor="report-horse">{t("Horse filter")}</label>
        <select
          id="report-horse"
          value={selectedHorseId}
          onChange={(event) => setSelectedHorseId(event.currentTarget.value)}
        >
          <option value="">{t("All horses")}</option>
          {(horses.data?.items ?? []).map((horse) => (
            <option key={horse.horseId} value={horse.horseId}>
              {horse.status === "Active" || horse.status === "Leased"
                ? horse.name
                : `${horse.name} (${t(horse.status)})`}
            </option>
          ))}
        </select>
        {monthly.isPending && (
          <p role="status">{t("Loading monthly report…")}</p>
        )}
        {monthly.isError && (
          <div role="alert">
            <p>{errorText(monthly.error)}</p>
            <button type="button" onClick={() => void monthly.refetch()}>
              {t("Retry monthly report")}
            </button>
          </div>
        )}
        {monthly.data &&
          (monthly.data.items.length === 0 ? (
            <p>{t("No financial activity for this selection.")}</p>
          ) : (
            <PnlTable
              month={monthly.data.month}
              currency={monthly.data.currency}
              items={monthly.data.items.map((item) => ({
                ...item,
                horseName: horseNames.get(item.horseId) ?? item.horseId,
              }))}
            />
          ))}
      </section>
      <section aria-labelledby="breakdown-heading">
        <h2 id="breakdown-heading">{t("Category and source")}</h2>
        {expenseBreakdown.isPending && (
          <p role="status">{t("Loading expense categories…")}</p>
        )}
        {expenseBreakdown.isError && (
          <div role="alert">
            <p>{t("Expense categories could not be loaded.")}</p>
            <button
              type="button"
              onClick={() => void expenseBreakdown.refetch()}
            >
              {t("Retry expense categories")}
            </button>
          </div>
        )}
        {expenseBreakdown.data &&
          (expenseBreakdown.data.items.length === 0 ? (
            <p>{t("No expenses in this period.")}</p>
          ) : (
            <BreakdownTable
              kind="expense"
              currency={expenseBreakdown.data.currency}
              from={from}
              to={to}
              items={expenseBreakdown.data.items}
              totalMinor={expenseBreakdown.data.totalMinor}
              horseName={
                selectedHorseId ? horseNames.get(selectedHorseId) : undefined
              }
            />
          ))}
        {incomeBreakdown.isPending && (
          <p role="status">{t("Loading income sources…")}</p>
        )}
        {incomeBreakdown.isError && (
          <div role="alert">
            <p>{t("Income sources could not be loaded.")}</p>
            <button
              type="button"
              onClick={() => void incomeBreakdown.refetch()}
            >
              {t("Retry income sources")}
            </button>
          </div>
        )}
        {incomeBreakdown.data &&
          (incomeBreakdown.data.items.length === 0 ? (
            <p>{t("No income in this period.")}</p>
          ) : (
            <BreakdownTable
              kind="income"
              currency={incomeBreakdown.data.currency}
              from={from}
              to={to}
              items={incomeBreakdown.data.items}
              totalMinor={incomeBreakdown.data.totalMinor}
              horseName={
                selectedHorseId ? horseNames.get(selectedHorseId) : undefined
              }
            />
          ))}
      </section>
      <section aria-labelledby="activity-report-heading">
        <h2 id="activity-report-heading">{t("Activity")}</h2>
        {activity.isPending && (
          <p role="status">{t("Loading activity summary…")}</p>
        )}
        {activity.isError && (
          <div role="alert">
            <p>{t("Activity summary could not be loaded.")}</p>
            <button type="button" onClick={() => void activity.refetch()}>
              {t("Retry activity")}
            </button>
          </div>
        )}
        {activity.data &&
          (activity.data.items.length === 0 ? (
            <p>{t("No activity in this period.")}</p>
          ) : (
            <ActivitySummary
              from={from}
              to={to}
              items={activity.data.items}
              horseName={
                selectedHorseId ? horseNames.get(selectedHorseId) : undefined
              }
            />
          ))}
      </section>
      <section aria-labelledby="lifetime-heading">
        <h2 id="lifetime-heading">{t("Lifetime report")}</h2>
        {lifetime.isPending && (
          <p role="status">{t("Loading lifetime report…")}</p>
        )}
        {lifetime.isError && (
          <div role="alert">
            <p>{errorText(lifetime.error)}</p>
            <button
              type="button"
              onClick={() =>
                void queryClient.resetQueries({ queryKey: lifetimeKey })
              }
            >
              {t("Restart lifetime report")}
            </button>
          </div>
        )}
        {pages.length > 0 && (
          <p>
            {t("Through ")}
            {formatDate(pages[0].asOfDate, locale)}
          </p>
        )}
        {lifetime.data && !isComplete && !lifetime.isError && (
          <p role="status">
            {t(
              "Lifetime totals are incomplete. Totals appear after every batch has loaded.",
            )}
          </p>
        )}
        {lifetime.data && isComplete && (
          <LifetimeTable pages={pages} horseNames={horseNames} />
        )}
        {lifetime.hasNextPage && !lifetime.isError && (
          <button
            type="button"
            disabled={lifetime.isFetchingNextPage}
            onClick={() => void lifetime.fetchNextPage()}
          >
            {lifetime.isFetchingNextPage
              ? t("Loading lifetime results…")
              : t("Load remaining lifetime results")}
          </button>
        )}
      </section>
    </section>
  );
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0));
  return date.toISOString().slice(0, 10);
}
