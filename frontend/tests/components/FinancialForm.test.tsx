import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  createApiClient,
  createAuthSessionBootstrap,
} from "../../src/api/client";
import { createSubjectQueryLifecycle } from "../../src/api/queryKeys";
import { AuthBoundary } from "../../src/auth/AuthBoundary";
import { ExpensesRoute } from "../../src/routes/expenses";
import { IncomeRoute } from "../../src/routes/income";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signedIn(fetchImpl: typeof fetch) {
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
  return { session, apiClient, queryClient, subjectLifecycle };
}

function accountResponse(streamVersion = 1) {
  return {
    currency: "EUR",
    timeZone: "Europe/Berlin",
    ownerToday: "2026-09-21",
    streamVersion,
    drivingRateMinorPerKm: null,
    settingsLocked: false,
  };
}

function horsesResponse(streamVersion = 1) {
  return {
    items: [
      {
        horseId: "horse-a",
        name: "Misty",
        breed: "Arabian",
        dateOfBirth: null,
        status: "Active",
        streamVersion,
      },
      {
        horseId: "horse-b",
        name: "Comet",
        breed: "Warmblood",
        dateOfBirth: null,
        status: "Leased",
        streamVersion,
      },
    ],
    nextCursor: null,
    streamVersion,
  };
}

function wrapper(children: ReactNode, fetchImpl: typeof fetch) {
  const { session, apiClient, queryClient, subjectLifecycle } =
    signedIn(fetchImpl);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthBoundary
        apiBaseUrl=""
        apiClient={apiClient}
        session={session}
        subjectLifecycle={subjectLifecycle}
      >
        {children}
      </AuthBoundary>
    </QueryClientProvider>
  );
}

function baseFetch(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  fetchImpl.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/auth/session")
      return jsonResponse({
        user: { id: "owner-a" },
        accessToken: "token-a",
        csrfToken: "csrf-a",
        expiresAt: "2026-10-08T18:00:00Z",
      });
    if (url === "/api/v1/account") return jsonResponse(accountResponse());
    if (url === "/api/v1/horses") return jsonResponse(horsesResponse());
    if (url.startsWith("/api/v1/expenses?"))
      return jsonResponse({ items: [], nextCursor: null, streamVersion: 1 });
    if (url.startsWith("/api/v1/income?"))
      return jsonResponse({ items: [], nextCursor: null, streamVersion: 1 });
    if (url === "/api/v1/history")
      return jsonResponse({ items: [], nextCursor: null, streamVersion: 1 });
    if (url === "/api/v1/reports/lifetime")
      return jsonResponse({
        currency: "EUR",
        asOfDate: "2026-10-08",
        items: [],
        streamVersion: 1,
        complete: true,
        nextCursor: null,
      });
    if (init?.method === "POST" && url === "/api/v1/previews/financial")
      return jsonResponse({});
    throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
  });
}

describe("one-time expense form", () => {
  test("shows ledger allocations and pages older entries", async () => {
    let pageRequests = 0;
    const fetchImpl = vi.fn<typeof fetch>();
    baseFetch(fetchImpl);
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
        });
      if (url === "/api/v1/account") return jsonResponse(accountResponse());
      if (url === "/api/v1/horses") return jsonResponse(horsesResponse());
      if (url.startsWith("/api/v1/expenses?")) {
        pageRequests += 1;
        if (url.includes("cursor=page-two"))
          return jsonResponse({
            items: [
              {
                id: "expense-b",
                expenseDate: "2026-09-08",
                amountMinor: 3000,
                category: "Feed",
                description: "Second bale",
                splitMode: "Equal",
                allocations: [],
                contributionMinor: 3000,
              },
            ],
            nextCursor: null,
            streamVersion: 2,
          });
        return jsonResponse({
          items: [
            {
              id: "expense-a",
              expenseDate: "2026-09-03",
              amountMinor: 1200,
              category: "Veterinary",
              description: "Checkup",
              splitMode: "Custom",
              allocations: [
                { horseId: "horse-a", weight: 1000000, amountMinor: 1200 },
              ],
              contributionMinor: 1200,
            },
          ],
          nextCursor: "page-two",
          streamVersion: 2,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(wrapper(<ExpensesRoute />, fetchImpl));
    expect(await screen.findByText("Checkup")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_text, element) =>
          element?.tagName === "P" &&
          element.textContent?.includes("€12.00") === true,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Allocations for Checkup")).getByText(
        /Misty.*€12\.00/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Second bale")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Load older expenses" }),
    );
    expect(await screen.findByText("Second bale")).toBeInTheDocument();
    expect(pageRequests).toBe(2);
  });
  test("uses server preview allocations, invalidates preview after edits, and commits at its stream version", async () => {
    const previewBodies: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>();
    baseFetch(fetchImpl);
    fetchImpl.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
          expiresAt: "2026-10-08T18:00:00Z",
        });
      if (url === "/api/v1/account") return jsonResponse(accountResponse());
      if (url === "/api/v1/horses") return jsonResponse(horsesResponse());
      if (url.startsWith("/api/v1/expenses?"))
        return jsonResponse({ items: [], nextCursor: null, streamVersion: 1 });
      if (url.startsWith("/api/v1/reports/lifetime"))
        return jsonResponse({
          currency: "EUR",
          asOfDate: "2026-10-08",
          items: [],
          streamVersion: 1,
          complete: true,
          nextCursor: null,
        });
      if (url === "/api/v1/previews/financial") {
        const body = JSON.parse(String(init?.body)) as {
          kind: string;
          values: { amountMinor: number };
        };
        previewBodies.push(body);
        return jsonResponse({
          currency: "EUR",
          date: "2026-09-21",
          amountMinor: body.values.amountMinor,
          splitMode: "Equal",
          allocations: [
            {
              horseId: "horse-a",
              weight: 500000,
              amountMinor: body.values.amountMinor === 1001 ? 501 : 600,
            },
            {
              horseId: "horse-b",
              weight: 500000,
              amountMinor: body.values.amountMinor === 1001 ? 500 : 400,
            },
          ],
          monthlyEffect: [
            {
              month: "2026-09",
              horseId: "horse-a",
              expenseDeltaMinor: body.values.amountMinor === 1001 ? 501 : 600,
              incomeDeltaMinor: 0,
              netDeltaMinor: body.values.amountMinor === 1001 ? -501 : -600,
            },
            {
              month: "2026-09",
              horseId: "horse-b",
              expenseDeltaMinor: body.values.amountMinor === 1001 ? 500 : 400,
              incomeDeltaMinor: 0,
              netDeltaMinor: body.values.amountMinor === 1001 ? -500 : -400,
            },
          ],
          streamVersion: 4,
        });
      }
      if (url === "/api/v1/expenses" && init?.method === "POST")
        return jsonResponse(
          {
            expenseId: "expense-a",
            allocations: [
              { horseId: "horse-a", weight: 500000, amountMinor: 600 },
              { horseId: "horse-b", weight: 500000, amountMinor: 400 },
            ],
            streamVersion: 5,
          },
          201,
        );
      if (url === "/api/v1/history")
        return jsonResponse({ items: [], nextCursor: null, streamVersion: 5 });
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(wrapper(<ExpensesRoute />, fetchImpl));
    await screen.findByRole("heading", { name: "Expenses" });
    await userEvent.click(
      screen.getByRole("button", { name: "Record expense" }),
    );
    await userEvent.type(screen.getByLabelText("Expense date"), "2026-09-21");
    await userEvent.type(screen.getByLabelText("Amount"), "10.01");
    await userEvent.selectOptions(
      screen.getByLabelText("Category"),
      "Veterinary",
    );
    await userEvent.type(screen.getByLabelText("Description"), "Clinic visit");
    await userEvent.click(screen.getByLabelText("Misty"));
    await userEvent.click(screen.getByLabelText("Comet"));
    await userEvent.click(
      screen.getByRole("button", { name: "Preview expense" }),
    );

    expect(await screen.findByText("Misty: €5.01")).toBeInTheDocument();
    expect(screen.getByText("Comet: €5.00")).toBeInTheDocument();
    expect(
      screen.getByText("2026-09: Misty expenses €5.01"),
    ).toBeInTheDocument();
    const previewCall = fetchImpl.mock.calls.find(
      ([url]) => String(url) === "/api/v1/previews/financial",
    );
    expect(previewBodies[0]).toEqual({
      kind: "Expense",
      values: {
        expenseDate: "2026-09-21",
        amountMinor: 1001,
        category: "Veterinary",
        description: "Clinic visit",
        split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
      },
    });
    const previewHeaders = new Headers(previewCall?.[1]?.headers);
    expect(previewHeaders.get("Authorization")).toBe("Bearer token-a");
    expect(previewHeaders.get("Content-Type")).toBe("application/json");
    expect(previewHeaders.has("Idempotency-Key")).toBe(false);
    expect(previewHeaders.has("If-Match")).toBe(false);

    await userEvent.clear(screen.getByLabelText("Amount"));
    await userEvent.type(screen.getByLabelText("Amount"), "12.00");
    expect(
      screen.queryByRole("button", { name: "Save expense" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview expense" }),
    );
    expect(await screen.findByText("Misty: €6.00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByText("Expense saved.")).toBeInTheDocument();

    const commit = fetchImpl.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/v1/expenses" && init?.method === "POST",
    );
    expect(commit?.[1]?.body).toBe(
      JSON.stringify({
        expenseDate: "2026-09-21",
        amountMinor: 1200,
        category: "Veterinary",
        description: "Clinic visit",
        split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
      }),
    );
    expect(new Headers(commit?.[1]?.headers).get("If-Match")).toBe('"4"');
    expect(new Headers(commit?.[1]?.headers).get("Idempotency-Key")).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(previewBodies).toHaveLength(2);
    expect(previewBodies[1]).toMatchObject({ values: { amountMinor: 1200 } });
  });

  test("focuses a rejected amount field and keeps its typed value", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    baseFetch(fetchImpl);
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
        });
      if (url === "/api/v1/account") return jsonResponse(accountResponse());
      if (url === "/api/v1/horses") return jsonResponse(horsesResponse());
      if (url.startsWith("/api/v1/expenses?"))
        return jsonResponse({ items: [], nextCursor: null, streamVersion: 1 });
      if (url === "/api/v1/previews/financial")
        return jsonResponse(
          {
            code: "validation_failed",
            message: "Check the amount.",
            correlationId: "safe-id",
            details: [
              { field: "amountMinor", message: "Enter a positive amount." },
            ],
          },
          400,
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    render(wrapper(<ExpensesRoute />, fetchImpl));
    await screen.findByRole("heading", { name: "Expenses" });
    await userEvent.click(
      screen.getByRole("button", { name: "Record expense" }),
    );
    const amount = screen.getByLabelText("Amount");
    await userEvent.type(amount, "10.00");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Feed");
    await userEvent.click(screen.getByLabelText("Misty"));
    await userEvent.click(
      screen.getByRole("button", { name: "Preview expense" }),
    );
    expect(
      await screen.findByText("Enter a positive amount."),
    ).toBeInTheDocument();
    expect(amount).toHaveValue(10);
    expect(amount).toHaveFocus();
  });

  test("retries an ambiguous expense commit with the exact command key and keeps form values", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn<typeof fetch>();
    baseFetch(fetchImpl);
    fetchImpl.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
        });
      if (url === "/api/v1/account") return jsonResponse(accountResponse());
      if (url === "/api/v1/horses") return jsonResponse(horsesResponse());
      if (url.startsWith("/api/v1/expenses?"))
        return jsonResponse({ items: [], nextCursor: null, streamVersion: 1 });
      if (url.startsWith("/api/v1/reports/lifetime"))
        return jsonResponse({
          currency: "EUR",
          asOfDate: "2026-10-08",
          items: [],
          streamVersion: 1,
          complete: true,
          nextCursor: null,
        });
      if (url === "/api/v1/previews/financial")
        return jsonResponse({
          currency: "EUR",
          date: "2026-09-21",
          amountMinor: 1000,
          splitMode: "Equal",
          allocations: [
            { horseId: "horse-a", weight: 500000, amountMinor: 500 },
            { horseId: "horse-b", weight: 500000, amountMinor: 500 },
          ],
          monthlyEffect: [],
          streamVersion: 2,
        });
      if (url === "/api/v1/expenses" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1)
          return jsonResponse(
            {
              code: "storage_unavailable",
              message: "Try the same save again.",
              correlationId: "safe-id",
            },
            503,
          );
        return jsonResponse(
          { expenseId: "expense-a", allocations: [], streamVersion: 3 },
          201,
        );
      }
      if (url === "/api/v1/history")
        return jsonResponse({ items: [], nextCursor: null, streamVersion: 3 });
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(wrapper(<ExpensesRoute />, fetchImpl));
    await screen.findByRole("heading", { name: "Expenses" });
    await userEvent.click(
      screen.getByRole("button", { name: "Record expense" }),
    );
    await userEvent.type(screen.getByLabelText("Expense date"), "2026-09-21");
    await userEvent.type(screen.getByLabelText("Amount"), "10.00");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Feed");
    await userEvent.click(screen.getByLabelText("Misty"));
    await userEvent.click(screen.getByLabelText("Comet"));
    await userEvent.click(
      screen.getByRole("button", { name: "Preview expense" }),
    );
    await screen.findByText("Misty: €5.00");
    await userEvent.click(screen.getByRole("button", { name: "Save expense" }));
    expect(
      await screen.findByText("Try the same save again."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toHaveValue(10);
    await userEvent.click(screen.getByRole("button", { name: "Save expense" }));

    const commands = fetchImpl.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/v1/expenses" && init?.method === "POST",
    );
    expect(commands).toHaveLength(2);
    expect(commands[1][1]?.body).toBe(commands[0][1]?.body);
    expect(new Headers(commands[1][1]?.headers).get("If-Match")).toBe(
      new Headers(commands[0][1]?.headers).get("If-Match"),
    );
    expect(new Headers(commands[1][1]?.headers).get("Idempotency-Key")).toBe(
      new Headers(commands[0][1]?.headers).get("Idempotency-Key"),
    );
  });
});

describe("one-time income form", () => {
  test("requires a fresh preview after a version conflict before creating a new command", async () => {
    let previews = 0;
    let commits = 0;
    const fetchImpl = vi.fn<typeof fetch>();
    baseFetch(fetchImpl);
    fetchImpl.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
        });
      if (url === "/api/v1/account") return jsonResponse(accountResponse());
      if (url === "/api/v1/horses") return jsonResponse(horsesResponse());
      if (url.startsWith("/api/v1/expenses?"))
        return jsonResponse({ items: [], nextCursor: null, streamVersion: 1 });
      if (url === "/api/v1/previews/financial") {
        previews += 1;
        return jsonResponse({
          currency: "EUR",
          date: "2026-09-21",
          amountMinor: 1000,
          splitMode: "Equal",
          allocations: [
            { horseId: "horse-a", weight: 500000, amountMinor: 500 },
            { horseId: "horse-b", weight: 500000, amountMinor: 500 },
          ],
          monthlyEffect: [],
          streamVersion: previews === 1 ? 3 : 4,
        });
      }
      if (url === "/api/v1/expenses" && init?.method === "POST") {
        commits += 1;
        if (commits === 1)
          return jsonResponse(
            {
              code: "stream_conflict",
              message: "The ledger changed. Review the updated preview.",
              correlationId: "safe-id",
              streamVersion: 4,
            },
            409,
          );
        return jsonResponse(
          { expenseId: "expense-a", allocations: [], streamVersion: 5 },
          201,
        );
      }
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(wrapper(<ExpensesRoute />, fetchImpl));
    await screen.findByRole("heading", { name: "Expenses" });
    await userEvent.click(
      screen.getByRole("button", { name: "Record expense" }),
    );
    await userEvent.type(screen.getByLabelText("Amount"), "10.00");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Feed");
    await userEvent.click(screen.getByLabelText("Misty"));
    await userEvent.click(screen.getByLabelText("Comet"));
    await userEvent.click(
      screen.getByRole("button", { name: "Preview expense" }),
    );
    await screen.findByText("Misty: €5.00");
    await userEvent.click(screen.getByRole("button", { name: "Save expense" }));
    expect(
      await screen.findByText(
        "The ledger changed. Review the updated preview.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toHaveValue(10);
    expect(
      screen.queryByRole("button", { name: "Save expense" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview expense" }),
    );
    await screen.findAllByText(/€5\.00/);
    await userEvent.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByText("Expense saved.")).toBeInTheDocument();
    const commands = fetchImpl.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/v1/expenses" && init?.method === "POST",
    );
    expect(commands).toHaveLength(2);
    expect(new Headers(commands[0][1]?.headers).get("If-Match")).toBe('"3"');
    expect(new Headers(commands[1][1]?.headers).get("If-Match")).toBe('"4"');
    expect(
      new Headers(commands[0][1]?.headers).get("Idempotency-Key"),
    ).not.toBe(new Headers(commands[1][1]?.headers).get("Idempotency-Key"));
    expect(commands[0][1]?.body).toBe(commands[1][1]?.body);
    expect(previews).toBe(2);
  });

  test("previews before committing immediately realized income with the server allocation", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>();
    baseFetch(fetchImpl);
    fetchImpl.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
        });
      if (url === "/api/v1/account") return jsonResponse(accountResponse());
      if (url === "/api/v1/horses") return jsonResponse(horsesResponse());
      if (url.startsWith("/api/v1/income?"))
        return jsonResponse({ items: [], nextCursor: null, streamVersion: 1 });
      if (url.startsWith("/api/v1/reports/lifetime"))
        return jsonResponse({
          currency: "EUR",
          asOfDate: "2026-10-08",
          items: [],
          streamVersion: 1,
          complete: true,
          nextCursor: null,
        });
      if (url === "/api/v1/previews/financial") {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        return jsonResponse({
          currency: "EUR",
          date: "2026-09-21",
          amountMinor: 2000,
          splitMode: "Equal",
          allocations: [
            { horseId: "horse-a", weight: 500000, amountMinor: 1000 },
            { horseId: "horse-b", weight: 500000, amountMinor: 1000 },
          ],
          monthlyEffect: [],
          streamVersion: 8,
        });
      }
      if (url === "/api/v1/income" && init?.method === "POST")
        return jsonResponse(
          { incomeId: "income-a", allocations: [], streamVersion: 9 },
          201,
        );
      if (url === "/api/v1/history")
        return jsonResponse({ items: [], nextCursor: null, streamVersion: 9 });
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    render(wrapper(<IncomeRoute />, fetchImpl));
    await screen.findByRole("heading", { name: "Income" });
    await userEvent.click(
      screen.getByRole("button", { name: "Record income" }),
    );
    await userEvent.type(screen.getByLabelText("Received date"), "2026-09-21");
    await userEvent.type(screen.getByLabelText("Amount"), "20.00");
    await userEvent.type(screen.getByLabelText("Source"), "Boarding");
    await userEvent.click(screen.getByLabelText("Misty"));
    await userEvent.click(screen.getByLabelText("Comet"));
    await userEvent.click(
      screen.getByRole("button", { name: "Preview income" }),
    );
    expect(await screen.findAllByText(/: €10\.00/)).toHaveLength(2);
    expect(bodies).toEqual([
      {
        kind: "Income",
        values: {
          receivedDate: "2026-09-21",
          amountMinor: 2000,
          source: "Boarding",
          split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
        },
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Save income" }));
    expect(await screen.findByText("Income saved.")).toBeInTheDocument();
    const commit = fetchImpl.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/v1/income" && init?.method === "POST",
    );
    expect(commit?.[1]?.body).toBe(
      JSON.stringify({
        receivedDate: "2026-09-21",
        amountMinor: 2000,
        source: "Boarding",
        split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
      }),
    );
    expect(new Headers(commit?.[1]?.headers).get("If-Match")).toBe('"8"');
  });
});
