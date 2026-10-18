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
import { createQueryKeys } from "../api/queryKeys";
import { useAuthServices } from "../auth/AuthBoundary";
import { DrivingRateForm } from "../features/driving/DrivingRateForm";

type AccountSettings = ApiResponse<"/api/v1/account", "get">;
type AccountHistoryPage = ApiResponse<"/api/v1/history", "get">;
interface AccountHistoryPageParam {
  cursor: string | null;
  streamVersion: number | null;
}

const currencies = [
  "EUR",
  "USD",
  "GBP",
  "CAD",
  "AUD",
  "CHF",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "JPY",
  "BHD",
  "KWD",
] as const;

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Settings could not be saved. Please try again.";
}

export function SettingsRoute() {
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState("EUR");
  const [timeZone, setTimeZone] = useState("");
  const [message, setMessage] = useState("");
  const pendingCommand = useRef<ApiCommand<"/api/v1/account", "PUT"> | null>(
    null,
  );
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
      setCurrency(result.currency ?? "EUR");
      setTimeZone(result.timeZone ?? "");
      apiClient.rememberVersion(subject!, result.streamVersion);
      return result;
    },
  });
  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!subject || !account.data)
        throw new Error("Account settings are still loading.");
      const body = { currency, timeZone };
      let command = pendingCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "PUT" ||
        command.path !== "/api/v1/account" ||
        command.body !== JSON.stringify(body) ||
        command.streamVersion !== account.data.streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "PUT",
          path: "/api/v1/account",
          body,
          streamVersion: account.data.streamVersion,
        });
        pendingCommand.current = command;
      }
      return await apiClient.sendCommand(command);
    },
    onSuccess: async (result) => {
      pendingCommand.current = null;
      if (subject) apiClient.rememberVersion(subject, result.streamVersion);
      queryClient.setQueryData(accountKey, result);
      setMessage("Account settings saved.");
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
        <h1>Settings</h1>
        <p role="status">Loading account settings…</p>
      </section>
    );
  if (account.isError)
    return (
      <section>
        <h1>Settings</h1>
        <p role="alert">{errorMessage(account.error)}</p>
        <button type="button" onClick={() => void account.refetch()}>
          Retry
        </button>
      </section>
    );
  const locked = account.data.settingsLocked;

  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading">Settings</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          saveSettings.mutate();
        }}
      >
        <label htmlFor="account-currency">Currency</label>
        <select
          id="account-currency"
          disabled={locked || saveSettings.isPending}
          onChange={(event) => setCurrency(event.currentTarget.value)}
          value={currency}
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <label htmlFor="account-time-zone">Time zone</label>
        <input
          id="account-time-zone"
          autoComplete="off"
          required
          disabled={locked || saveSettings.isPending}
          onChange={(event) => setTimeZone(event.currentTarget.value)}
          value={timeZone}
          placeholder="Europe/Berlin"
        />
        {locked ? (
          <p>Settings are locked after financial activity.</p>
        ) : (
          <button
            disabled={!timeZone.trim() || saveSettings.isPending}
            type="submit"
          >
            Save settings
          </button>
        )}
        {saveSettings.isError && (
          <p role="alert">{errorMessage(saveSettings.error)}</p>
        )}
        {message && <p role="status">{message}</p>}
      </form>
      <DrivingRateForm
        savedRateMinorPerKm={account.data.drivingRateMinorPerKm ?? null}
        pending={saveDrivingRate.isPending}
        errorMessage={
          saveDrivingRate.isError
            ? errorMessage(saveDrivingRate.error)
            : undefined
        }
        onSave={(rate) =>
          saveDrivingRate.mutateAsync(rate).then(() => undefined)
        }
      />
      <section aria-labelledby="account-history-heading">
        <h2 id="account-history-heading">Account history</h2>
        {history.isPending && <p role="status">Loading history…</p>}
        {history.isError && (
          <div role="alert">
            <p>
              {history.error instanceof Error
                ? history.error.message
                : "History could not be loaded. Please try again."}
            </p>
            <button type="button" onClick={() => void history.refetch()}>
              Reload history
            </button>
          </div>
        )}
        {history.data &&
          history.data.pages.flatMap((page) => page.items).length === 0 && (
            <p>No account history yet.</p>
          )}
        {history.data &&
          history.data.pages.flatMap((page) => page.items).length > 0 && (
            <ol aria-label="Account history entries">
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
    </section>
  );
}
