import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import type { ApiCommand, ApiResponse } from "../api/client";
import { createQueryKeys, invalidateSubjectLists } from "../api/queryKeys";
import { useAuthServices } from "../auth/AuthBoundary";
import { TaskForm, type TaskCommandBody } from "../features/tasks/TaskForm";

type TaskPage = ApiResponse<"/api/v1/tasks", "get">;
interface TaskPageParam {
  cursor: string | null;
  streamVersion: number | null;
}

function startOfMonth(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

export function TasksRoute() {
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const [taskReloadGeneration, setTaskReloadGeneration] = useState(0);
  const keys = subject ? createQueryKeys(subject) : null;
  const pendingCommand = useRef<ApiCommand<"/api/v1/tasks", "POST"> | null>(
    null,
  );
  const account = useQuery({
    queryKey: keys?.account ?? ["account", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    queryFn: async () =>
      await apiClient.get({
        subject: subject!,
        path: "/api/v1/account",
      }),
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
  const from = startOfMonth(today);
  const taskKey = keys?.tasks({
    from,
    to: today,
    reload: taskReloadGeneration,
  }) ?? ["tasks", "unavailable", from, today, taskReloadGeneration];
  const tasks = useInfiniteQuery<
    TaskPage,
    Error,
    InfiniteData<TaskPage>,
    QueryKey,
    TaskPageParam
  >({
    queryKey: taskKey,
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    retry: false,
    initialPageParam: { cursor: null, streamVersion: null },
    queryFn: async ({ pageParam }) => {
      if (pageParam.cursor && pageParam.streamVersion !== null) {
        const latest = apiClient.lastSeenVersion(subject!);
        if (latest !== undefined && latest !== pageParam.streamVersion)
          throw new Error("Tasks changed while paging. Reload the task list.");
      }
      const query = new URLSearchParams({ from, to: today, limit: "100" });
      if (pageParam.cursor) query.set("cursor", pageParam.cursor);
      const path = `/api/v1/tasks?${query}` as `/api/v1/tasks?${string}`;
      const result = await apiClient.get({
        subject: subject!,
        path,
      });
      if (
        pageParam.streamVersion !== null &&
        result.streamVersion !== pageParam.streamVersion
      )
        throw new Error(
          "Task list changed while paging. Reload the task list.",
        );
      apiClient.rememberVersion(subject!, result.streamVersion);
      return result;
    },
    getNextPageParam: (page) =>
      page.nextCursor
        ? { cursor: page.nextCursor, streamVersion: page.streamVersion }
        : undefined,
  });
  const activityKey = keys?.report("activity", { from, to: today }) ?? [
    "report",
    "unavailable",
    "activity",
    from,
    today,
  ];
  const activity = useQuery({
    queryKey: activityKey,
    enabled:
      canLoadProtectedData && subject !== null && account.data !== undefined,
    queryFn: async () => {
      const path =
        `/api/v1/reports/activity?${new URLSearchParams({ from, to: today })}` as `/api/v1/reports/activity?${string}`;
      return await apiClient.get({
        subject: subject!,
        path,
      });
    },
  });
  const createTask = useMutation({
    mutationFn: async (body: TaskCommandBody) => {
      if (!subject || !account.data)
        throw new Error("Task setup is still loading.");
      const serialized = JSON.stringify(body);
      let command = pendingCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.body !== serialized ||
        command.streamVersion !== account.data.streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "POST",
          path: "/api/v1/tasks",
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
      if (subject) await invalidateSubjectLists(queryClient, subject, "tasks");
      if (subject)
        await queryClient.invalidateQueries({ queryKey: activityKey });
      if (subject)
        await queryClient.invalidateQueries({ queryKey: ["history", subject] });
    },
  });
  const horseNames = new Map(
    (horses.data?.items ?? []).map((item) => [item.horseId, item.name]),
  );

  return (
    <section aria-labelledby="tasks-heading">
      <h1 id="tasks-heading">Tasks</h1>
      {(account.isPending || horses.isPending) && (
        <p role="status">Loading task setup…</p>
      )}
      {(account.isError || horses.isError) && (
        <p role="alert">Task setup could not be loaded.</p>
      )}
      {account.data && horses.data && (
        <TaskForm
          horses={horses.data.items.filter(
            (item) => item.status === "Active" || item.status === "Leased",
          )}
          today={today}
          pending={createTask.isPending}
          errorMessage={
            createTask.isError ? createTask.error.message : undefined
          }
          onSubmit={(body) =>
            createTask.mutateAsync(body).then(() => undefined)
          }
        />
      )}
      <section aria-labelledby="task-list-heading">
        <h2 id="task-list-heading">Recent tasks</h2>
        {tasks.isPending && <p role="status">Loading tasks…</p>}
        {tasks.isError && (
          <div role="alert">
            <p>{tasks.error.message}</p>
            <button
              type="button"
              onClick={() => {
                queryClient.removeQueries({ queryKey: taskKey, exact: true });
                setTaskReloadGeneration((generation) => generation + 1);
              }}
            >
              Reload tasks
            </button>
          </div>
        )}
        {tasks.data &&
          tasks.data.pages.flatMap((page) => page.items).length === 0 && (
            <p>No tasks recorded this month.</p>
          )}
        {tasks.data &&
          tasks.data.pages.flatMap((page) => page.items).length > 0 && (
            <ul aria-label="Recent tasks">
              {tasks.data.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <li key={item.taskId}>
                    <strong>
                      {horseNames.get(item.horseId) ?? item.horseId}
                    </strong>{" "}
                    · {item.taskType.replace(/([a-z])([A-Z])/g, "$1 $2")} ·{" "}
                    {item.taskDate}
                    {item.minutes > 0 && <span> · {item.minutes} minutes</span>}
                    {item.quantity !== undefined && (
                      <span>
                        {" "}
                        · {item.quantity} {item.quantityUnit}
                      </span>
                    )}
                    {item.notes && <p>{item.notes}</p>}
                  </li>
                ))}
            </ul>
          )}
        {tasks.hasNextPage && !tasks.isError && (
          <button
            type="button"
            disabled={tasks.isFetchingNextPage}
            onClick={() => void tasks.fetchNextPage()}
          >
            {tasks.isFetchingNextPage ? "Loading tasks…" : "Load more tasks"}
          </button>
        )}
      </section>
      <section aria-labelledby="activity-heading">
        <h2 id="activity-heading">Activity this month</h2>
        {activity.isPending && <p role="status">Loading activity…</p>}
        {activity.isError && (
          <p role="alert">Activity summary could not be loaded.</p>
        )}
        {activity.data && activity.data.items.length === 0 && (
          <p>No activity recorded this month.</p>
        )}
        {activity.data && activity.data.items.length > 0 && (
          <ul aria-label="Activity summary">
            {activity.data.items.map((row) => (
              <li key={row.taskType}>
                {row.taskType.replace(/([a-z])([A-Z])/g, "$1 $2")}: {row.count}{" "}
                tasks, {row.minutes} minutes
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
