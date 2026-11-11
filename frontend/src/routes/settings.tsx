import { HistoryDetails } from "../components/HistoryDetails";
import { useI18n } from "../i18n/I18nProvider";
import { PageHeading } from "../components/PageHeading";
import { useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import { ApiError, type ApiCommand, type ApiResponse } from "../api/client";
import { createQueryKeys } from "../api/queryKeys";
import { useAuthServices } from "../auth/AuthBoundary";
import { DrivingRateForm } from "../features/driving/DrivingRateForm";

type AccountSettings = ApiResponse<"/api/v1/account", "get">;
type AccountHistoryPage = ApiResponse<"/api/v1/history", "get">;
interface AccountHistoryPageParam {
  cursor: string | null;
  streamVersion: number | null;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Settings could not be saved. Please try again.";
}

export function SettingsRoute() {
  const { t, locale, errorText } = useI18n();
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const pendingRateCommand = useRef<ApiCommand<
    "/api/v1/driving-rate",
    "PUT"
  > | null>(null);
  const keys = subject ? createQueryKeys(subject) : null;
  const accountKey = keys?.account ?? ["account", "unavailable"];
  const account = useQuery({
    queryKey: accountKey,
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
  const saveDrivingRate = useMutation({
    mutationFn: async (rateMinorPerKm: number) => {
      if (!subject || !account.data)
        throw new Error("Account settings are still loading.");
      const body = { rateMinorPerKm };
      let command = pendingRateCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "PUT" ||
        command.path !== "/api/v1/driving-rate" ||
        command.body !== JSON.stringify(body) ||
        command.streamVersion !== account.data.streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "PUT",
          path: "/api/v1/driving-rate",
          body,
          streamVersion: account.data.streamVersion,
        });
        pendingRateCommand.current = command;
      }
      return await apiClient.sendCommand(command);
    },
    onSuccess: (result) => {
      pendingRateCommand.current = null;
      if (subject) apiClient.rememberVersion(subject, result.streamVersion);
      queryClient.setQueryData<AccountSettings>(accountKey, (current) =>
        current
          ? {
              ...current,
              drivingRateMinorPerKm: result.rateMinorPerKm,
              streamVersion: result.streamVersion,
            }
          : current,
      );
    },
  });
  const history = useInfiniteQuery<
    AccountHistoryPage,
    Error,
    InfiniteData<AccountHistoryPage>,
    QueryKey,
    AccountHistoryPageParam
  >({
    queryKey: keys?.history({
      scope: "account",
      streamVersion: account.data?.streamVersion ?? 0,
    }) ?? ["history", "unavailable"],
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    initialPageParam: {
      cursor: null,
      streamVersion: null,
    } as AccountHistoryPageParam,
    queryFn: async ({ pageParam }): Promise<AccountHistoryPage> => {
      if (pageParam.cursor && pageParam.streamVersion !== null) {
        const currentVersion = apiClient.lastSeenVersion(subject!);
        if (
          currentVersion !== undefined &&
          currentVersion !== pageParam.streamVersion
        ) {
          throw new Error(
            "History changed while you were paging. Reload history to continue.",
          );
        }
      }
      const query = new URLSearchParams();
      if (pageParam.cursor) query.set("cursor", pageParam.cursor);
      const suffix = query.toString();
      const path = suffix
        ? (`/api/v1/history?${suffix}` as `/api/v1/history?${string}`)
        : "/api/v1/history";
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

  if (account.isPending)
    return (
      <section aria-busy="true">
        <h1>{t("Settings")}</h1>
        <p role="status">{t("Loading account settings…")}</p>
      </section>
    );
  if (account.isError)
    return (
      <section>
        <h1>{t("Settings")}</h1>
        <p role="alert">
          {errorText(account.error, errorMessage(account.error))}
        </p>
        <button type="button" onClick={() => void account.refetch()}>
          {t("Retry")}
        </button>
      </section>
    );
  return (
    <section aria-labelledby="settings-heading">
      <PageHeading
        id="settings-heading"
        title={t("Settings")}
        description={t("The details that keep your ledger running smoothly.")}
      />
      <div className="settings-layout">
        <div className="settings-main">
          <DrivingRateForm
            currency={account.data?.currency ?? "EUR"}
            savedRateMinorPerKm={account.data.drivingRateMinorPerKm ?? null}
            pending={saveDrivingRate.isPending}
            errorMessage={
              saveDrivingRate.isError
                ? errorText(
                    saveDrivingRate.error,
                    errorMessage(saveDrivingRate.error),
                  )
                : undefined
            }
            onSave={(rate) =>
              saveDrivingRate.mutateAsync(rate).then(() => undefined)
            }
          />
        </div>
        <aside className="settings-aside">
          <div className="settings-note">
            <span className="eyebrow">{t("Good to know")}</span>
            <h2>{t("A consistent ledger starts here.")}</h2>
            <p>{t("Calendar dates on financial records stay unchanged.")}</p>
            <hr />
            <p>
              {t(
                "Your driving rate can be updated whenever your travel costs change.",
              )}
            </p>
          </div>
        </aside>
      </div>
      <section
        className="history-card"
        aria-labelledby="account-history-heading"
      >
        <div className="card-heading">
          <span className="section-number">02</span>
          <div>
            <h2 id="account-history-heading">{t("Account history")}</h2>
            <p>{t("A record of changes to your workspace.")}</p>
          </div>
        </div>
        {history.isPending && <p role="status">{t("Loading history…")}</p>}
        {history.isError && (
          <div role="alert">
            <p>
              {history.error instanceof Error
                ? errorText(history.error)
                : t("History could not be loaded. Please try again.")}
            </p>
            <button type="button" onClick={() => void history.refetch()}>
              {t("Reload history")}
            </button>
          </div>
        )}
        {history.data &&
          history.data.pages.flatMap((page) => page.items).length === 0 && (
            <div className="empty-state">
              <span className="empty-state-symbol" aria-hidden="true">
                ↺
              </span>
              <p>{t("No account history yet.")}</p>
              <small>{t("Changes to your account will appear here.")}</small>
            </div>
          )}
        {history.data &&
          history.data.pages.flatMap((page) => page.items).length > 0 && (
            <ol aria-label={t("Account history entries")}>
              {history.data.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <li key={item.eventId}>
                    <p>{item.summary}</p>
                    <HistoryDetails
                      item={item}
                      currency={account.data?.currency ?? "EUR"}
                    />
                    <time dateTime={item.occurredAt}>
                      {new Date(item.occurredAt).toLocaleString(locale)}
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
              ? t("Loading older history…")
              : t("Load older history")}
          </button>
        )}
      </section>
    </section>
  );
}
