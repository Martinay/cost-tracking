import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import {
  createApiClient,
  createAuthSessionBootstrap,
} from "../../src/api/client";
import { createSubjectQueryLifecycle } from "../../src/api/queryKeys";
import { AuthBoundary } from "../../src/auth/AuthBoundary";
import { TasksRoute } from "../../src/routes/tasks";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function taskFixture(firstStatus?: 409 | 503) {
  let version = 1;
  let attempts = 0;
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    if (path === "/auth/session")
      return response({
        user: { id: "task-owner" },
        accessToken: "synthetic-token",
        csrfToken: "synthetic-csrf",
      });
    if (path === "/api/v1/account")
      return response({
        currency: "EUR",
        timeZone: "UTC",
        ownerToday: "2026-09-21",
        streamVersion: version,
      });
    if (path === "/api/v1/horses")
      return response({
        items: [
          {
            horseId: "horse-a",
            name: "Luna",
            status: firstStatus ? "Active" : "Sold",
          },
          { horseId: "horse-b", name: "Fiete", status: "Active" },
          { horseId: "horse-c", name: "Maja", status: "Sold" },
        ],
        nextCursor: null,
        streamVersion: version,
      });
    if (
      path === "/api/v1/tasks/task-a/corrections" &&
      init?.method === "POST"
    ) {
      attempts++;
      version = 2;
      if (attempts === 1 && firstStatus)
        return response(
          {
            code:
              firstStatus === 409 ? "version_conflict" : "storage_unavailable",
            message:
              firstStatus === 409
                ? "Review and retry."
                : "Retry the same save.",
            correlationId: "synthetic",
          },
          firstStatus,
        );
      return response({ taskId: "task-a", streamVersion: version });
    }
    if (path.startsWith("/api/v1/tasks?"))
      return response({
        items: [
          {
            taskId: "task-a",
            horseId: "horse-a",
            taskDate: "2026-09-20",
            taskType: "Riding",
            minutes: 45,
            quantity: null,
            quantityUnit: null,
            notes: "Original ride",
            streamVersion: 1,
          },
        ],
        nextCursor: null,
        streamVersion: version,
      });
    if (path.startsWith("/api/v1/reports/activity?"))
      return response({ items: [], streamVersion: version });
    throw new Error(`Unexpected request: ${path}`);
  });
  const session = createAuthSessionBootstrap({ fetchImpl });
  const apiClient = createApiClient({
    fetchImpl,
    getAccessToken: () => session.getAccessToken(),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const subjectLifecycle = createSubjectQueryLifecycle(
    queryClient,
    apiClient.setSubject,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <AuthBoundary
        apiBaseUrl=""
        apiClient={apiClient}
        session={session}
        subjectLifecycle={subjectLifecycle}
      >
        <TasksRoute />
      </AuthBoundary>
    </QueryClientProvider>,
  );
  return fetchImpl;
}

test("historical task corrections retain their sold horse without offering unrelated sold horses", async () => {
  const fetchImpl = taskFixture();
  await userEvent.click(
    await screen.findByRole("button", { name: "Correct task" }),
  );
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("Horse")).toHaveValue("horse-a");
  expect(dialog.getByRole("option", { name: "Luna" })).toBeInTheDocument();
  expect(dialog.getByRole("option", { name: "Fiete" })).toBeInTheDocument();
  expect(
    dialog.queryByRole("option", { name: "Maja" }),
  ).not.toBeInTheDocument();
  await userEvent.type(
    dialog.getByLabelText("Reason for correction"),
    "Correct the timer",
  );
  await userEvent.clear(dialog.getByLabelText("Minutes"));
  await userEvent.type(dialog.getByLabelText("Minutes"), "30");
  await userEvent.click(dialog.getByRole("button", { name: "Save task" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const post = fetchImpl.mock.calls.find(
    ([path, init]) =>
      String(path).endsWith("/corrections") && init?.method === "POST",
  );
  expect(JSON.parse(String(post?.[1]?.body)).values).toMatchObject({
    horseId: "horse-a",
    minutes: 30,
  });
});

for (const status of [409, 503] as const) {
  test(
    status === 409
      ? "a task correction retries unchanged draft with a fresh command after a version conflict"
      : "an ambiguous task correction retries the original command even after the account version advances",
    async () => {
      const fetchImpl = taskFixture(status);
      await userEvent.click(
        await screen.findByRole("button", { name: "Correct task" }),
      );
      const dialog = within(screen.getByRole("dialog"));
      await userEvent.type(
        dialog.getByLabelText("Reason for correction"),
        "Correct the notes",
      );
      const notes = dialog.getByLabelText("Notes");
      await userEvent.clear(notes);
      await userEvent.type(notes, "Corrected ride");
      await userEvent.click(dialog.getByRole("button", { name: "Save task" }));
      expect(await dialog.findByRole("alert")).toHaveTextContent(
        status === 409 ? "Review and retry." : "Retry the same save.",
      );
      expect(notes).toHaveValue("Corrected ride");
      await userEvent.click(dialog.getByRole("button", { name: "Save task" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      const posts = fetchImpl.mock.calls.filter(
        ([path, init]) =>
          String(path).endsWith("/corrections") && init?.method === "POST",
      );
      expect(posts).toHaveLength(2);
      expect(posts[1][1]?.body).toBe(posts[0][1]?.body);
      const first = new Headers(posts[0][1]?.headers);
      const second = new Headers(posts[1][1]?.headers);
      expect(first.get("If-Match")).toBe('"1"');
      expect(second.get("If-Match")).toBe(status === 409 ? '"2"' : '"1"');
      if (status === 409)
        expect(second.get("Idempotency-Key")).not.toBe(
          first.get("Idempotency-Key"),
        );
      else
        expect(second.get("Idempotency-Key")).toBe(
          first.get("Idempotency-Key"),
        );
    },
  );
}
