import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type ApiCommand } from "../api/client";
import { createQueryKeys, invalidateSubjectLists } from "../api/queryKeys";
import { useAuthServices } from "../auth/AuthBoundary";
import { HorseForm, type HorseFormValue } from "../features/horses/HorseForm";

function requestError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Horses could not be loaded. Please try again.";
}

export function HorsesRoute() {
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const pendingCommand = useRef<ApiCommand<"/api/v1/horses", "POST"> | null>(
    null,
  );
  const keys = subject ? createQueryKeys(subject) : null;
  const account = useQuery({
    queryKey: keys?.account ?? ["account", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    queryFn: async () =>
      await apiClient.get({ subject: subject!, path: "/api/v1/account" }),
  });
  const horses = useQuery({
    queryKey: keys?.horses() ?? ["horses", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    queryFn: async () => {
      const list = await apiClient.get({
        subject: subject!,
        path: "/api/v1/horses",
      });
      apiClient.rememberVersion(subject!, list.streamVersion);
      return list;
    },
  });
  const createHorse = useMutation({
    mutationFn: async (value: HorseFormValue) => {
      if (!subject || !horses.data)
        throw new Error("Horse list is still loading.");
      let command = pendingCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.method !== "POST" ||
        command.path !== "/api/v1/horses" ||
        command.body !== JSON.stringify(value) ||
        command.streamVersion !== horses.data.streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "POST",
          path: "/api/v1/horses",
          body: value,
          streamVersion: horses.data.streamVersion,
        });
        pendingCommand.current = command;
      }
      return await apiClient.sendCommand(command);
    },
    onSuccess: async (result) => {
      pendingCommand.current = null;
      if (subject) apiClient.rememberVersion(subject, result.streamVersion);
      setAdding(false);
      setNotice("Horse saved.");
      if (subject) await invalidateSubjectLists(queryClient, subject, "horses");
    },
  });

  if (account.isPending || horses.isPending)
    return (
      <section aria-busy="true">
        <h1>Your horses</h1>
        <p role="status">Loading your horses…</p>
      </section>
    );
  if (account.isError || horses.isError)
    return (
      <section>
        <h1>Your horses</h1>
        <p role="alert">{requestError(account.error ?? horses.error)}</p>
        <button
          type="button"
          onClick={() => {
            void account.refetch();
            void horses.refetch();
          }}
        >
          Retry
        </button>
      </section>
    );
  const needsSetup =
    account.data.currency === null || account.data.timeZone === null;

  return (
    <section aria-labelledby="horses-heading">
      <h1 id="horses-heading">Your horses</h1>
      {notice && <p role="status">{notice}</p>}
      {needsSetup ? (
        <p>
          Set your account currency and time zone before adding horses.{" "}
          <a href="/settings">Configure settings</a>
        </p>
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Add horse
        </button>
      )}
      {horses.data.items.length === 0 ? (
        <p>No horses yet.</p>
      ) : (
        <ul aria-label="Horses">
          {horses.data.items.map((horse) => (
            <li key={horse.horseId}>
              <h2>{horse.name}</h2>
              <p>{horse.breed || "Breed not specified"}</p>
              <p>
                Status: <span>{horse.status}</span>
              </p>
              <a
                href={`/horses/${encodeURIComponent(horse.horseId)}`}
                aria-label={`View ${horse.name}`}
              >
                View {horse.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-horse-heading"
        >
          <h2 id="add-horse-heading">Add horse</h2>
          <HorseForm
            mode="create"
            isSaving={createHorse.isPending}
            errorMessage={
              createHorse.isError ? requestError(createHorse.error) : undefined
            }
            onCancel={() => setAdding(false)}
            onSubmit={(value) =>
              createHorse.mutateAsync(value).then(() => undefined)
            }
          />
        </div>
      )}
    </section>
  );
}
