import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  createApiClient,
  createAuthSessionBootstrap,
} from "../../src/api/client";
import { createSubjectQueryLifecycle } from "../../src/api/queryKeys";
import { AuthBoundary } from "../../src/auth/AuthBoundary";
import { ReportsRoute } from "../../src/routes/reports";
import { HorseDetailRoute } from "../../src/routes/horses.$horseId";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wrapped(children: ReactNode, fetchImpl: typeof fetch) {
  const session = createAuthSessionBootstrap({ fetchImpl });
  const apiClient = createApiClient({
    fetchImpl,
    getAccessToken: session.getAccessToken,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const subjectLifecycle = createSubjectQueryLifecycle(
    queryClient,
    apiClient.setSubject,
  );
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

function common(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  fetchImpl.mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/auth/session")
      return jsonResponse({
        user: { id: "owner-a" },
        accessToken: "token-a",
        csrfToken: "csrf-a",
      });
    if (url === "/api/v1/account")
      return jsonResponse({
        currency: "EUR",
        timeZone: "Europe/Berlin",
        ownerToday: "2026-09-21",
        streamVersion: 7,
      });
    if (url === "/api/v1/horses")
      return jsonResponse({
        items: [
          { horseId: "horse-retired", name: "Misty", status: "Retired" },
          { horseId: "horse-sold", name: "Comet", status: "Sold" },
        ],
        streamVersion: 7,
      });
    if (url.startsWith("/api/v1/reports/monthly-pnl?"))
      return jsonResponse({
        currency: "EUR",
        month: "2026-09",
        streamVersion: 7,
        items: [
          {
            horseId: "horse-retired",
            incomeMinor: 10000,
            expenseMinor: 4000,
            netMinor: 6000,
          },
          {
            horseId: "horse-sold",
            incomeMinor: 20000,
            expenseMinor: 8000,
            netMinor: 12000,
          },
        ],
      });
    if (url.startsWith("/api/v1/reports/lifetime?"))
      return jsonResponse({
        currency: "EUR",
        asOfDate: "2026-09-21",
        streamVersion: 7,
        complete: false,
        nextCursor: "next-batch",
        items: [
          {
            horseId: "horse-retired",
            incomeMinor: 10000,
            expenseMinor: 4000,
            netMinor: 6000,
          },
        ],
      });
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("financial report tables", () => {
  test("reports a failed monthly query with a retry that reveals loaded results", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<typeof fetch>();
    let monthlyAttempts = 0;
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
        });
      if (url === "/api/v1/account")
        return jsonResponse({
          currency: "EUR",
          timeZone: "Europe/Berlin",
          ownerToday: "2026-09-21",
          streamVersion: 7,
        });
      if (url === "/api/v1/horses")
        return jsonResponse({ items: [], streamVersion: 7 });
      if (url.startsWith("/api/v1/reports/monthly-pnl?")) {
        monthlyAttempts += 1;
        if (monthlyAttempts === 1)
          return jsonResponse(
            {
              code: "temporarily_unavailable",
              message: "Monthly report is unavailable.",
              correlationId: "report-retry",
            },
            503,
          );
        return jsonResponse({
          currency: "EUR",
          month: "2026-09",
          streamVersion: 7,
          items: [],
        });
      }
      if (url.startsWith("/api/v1/reports/breakdown?"))
        return jsonResponse({
          currency: "EUR",
          items: [],
          totalMinor: 0,
          streamVersion: 7,
          asOfDate: "2026-09-21",
        });
      if (url.startsWith("/api/v1/reports/activity?"))
        return jsonResponse({ items: [], streamVersion: 7 });
      if (url.startsWith("/api/v1/reports/lifetime?"))
        return jsonResponse({
          currency: "EUR",
          asOfDate: "2026-09-21",
          streamVersion: 7,
          complete: true,
          nextCursor: null,
          items: [],
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(wrapped(<ReportsRoute />, fetchImpl));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Monthly report is unavailable.",
    );
    expect(screen.queryByTestId("report-ready")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Retry monthly report" }),
    );
    expect(
      await screen.findByText("No financial activity for this selection."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("report-ready")).toBeInTheDocument();
    expect(monthlyAttempts).toBe(2);
  });

  test("includes inactive horses and reveals lifetime totals only after all batches load", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    common(fetchImpl);
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
        });
      if (url === "/api/v1/account")
        return jsonResponse({
          currency: "EUR",
          timeZone: "Europe/Berlin",
          ownerToday: "2026-09-21",
          streamVersion: 7,
        });
      if (url === "/api/v1/horses")
        return jsonResponse({
          items: [
            { horseId: "horse-retired", name: "Misty", status: "Retired" },
            { horseId: "horse-sold", name: "Comet", status: "Sold" },
          ],
          streamVersion: 7,
        });
      if (url.startsWith("/api/v1/reports/monthly-pnl?"))
        return jsonResponse({
          currency: "EUR",
          month: "2026-09",
          streamVersion: 7,
          items: [
            {
              horseId: "horse-retired",
              incomeMinor: 10000,
              expenseMinor: 4000,
              netMinor: 6000,
            },
            {
              horseId: "horse-sold",
              incomeMinor: 20000,
              expenseMinor: 8000,
              netMinor: 12000,
            },
          ],
        });
      if (url.startsWith("/api/v1/reports/breakdown?"))
        return jsonResponse({
          currency: "EUR",
          items: [],
          totalMinor: 0,
          streamVersion: 7,
          asOfDate: "2026-09-21",
        });
      if (url.startsWith("/api/v1/reports/activity?"))
        return jsonResponse({ items: [], streamVersion: 7 });
      if (
        url.includes("/api/v1/reports/lifetime?") &&
        url.includes("cursor=next-batch")
      )
        return jsonResponse({
          currency: "EUR",
          asOfDate: "2026-09-21",
          streamVersion: 7,
          complete: true,
          nextCursor: null,
          items: [
            {
              horseId: "horse-sold",
              incomeMinor: 20000,
              expenseMinor: 8000,
              netMinor: 12000,
            },
          ],
        });
      if (url.startsWith("/api/v1/reports/lifetime?"))
        return jsonResponse({
          currency: "EUR",
          asOfDate: "2026-09-21",
          streamVersion: 7,
          complete: false,
          nextCursor: "next-batch",
          items: [
            {
              horseId: "horse-retired",
              incomeMinor: 10000,
              expenseMinor: 4000,
              netMinor: 6000,
            },
          ],
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(wrapped(<ReportsRoute />, fetchImpl));
    expect(
      await screen.findByRole("table", { name: "Monthly profit and loss" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Misty (Retired)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Comet (Sold)").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        (_text, element) =>
          element?.tagName === "P" &&
          element.textContent?.includes("Through 2026-09-21") === true,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "Lifetime totals" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Total income")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Load remaining lifetime results" }),
    );
    expect(
      await screen.findByRole("table", { name: "Lifetime totals" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Total income")).toBeInTheDocument();
    expect(screen.getByText("€300.00")).toBeInTheDocument();
    expect(screen.getAllByText("€120.00").length).toBeGreaterThan(0);
    expect(screen.getByText("€180.00")).toBeInTheDocument();
    expect(screen.getAllByText("Misty (Retired)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Comet (Sold)").length).toBeGreaterThan(0);
  });

  test("restarts incomplete lifetime accumulation when the cursor is stale", async () => {
    let cursorCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>();
    common(fetchImpl);
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/auth/session")
        return jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
        });
      if (url === "/api/v1/account")
        return jsonResponse({
          currency: "EUR",
          timeZone: "Europe/Berlin",
          ownerToday: "2026-09-21",
          streamVersion: 7,
        });
      if (url === "/api/v1/horses")
        return jsonResponse({
          items: [
            { horseId: "horse-retired", name: "Misty", status: "Retired" },
          ],
          streamVersion: 7,
        });
      if (url.startsWith("/api/v1/reports/monthly-pnl?"))
        return jsonResponse({
          currency: "EUR",
          month: "2026-09",
          streamVersion: 7,
          items: [],
        });
      if (url.startsWith("/api/v1/reports/breakdown?"))
        return jsonResponse({
          currency: "EUR",
          items: [],
          totalMinor: 0,
          streamVersion: 7,
          asOfDate: "2026-09-21",
        });
      if (url.startsWith("/api/v1/reports/activity?"))
        return jsonResponse({ items: [], streamVersion: 7 });
      if (url.includes("cursor=next-batch")) {
        cursorCalls += 1;
        return jsonResponse(
          {
            code: "invalid_cursor",
            message: "The report changed. Reload it.",
            correlationId: "safe-id",
            streamVersion: 8,
          },
          409,
        );
      }
      if (url.startsWith("/api/v1/reports/lifetime?")) {
        if (cursorCalls === 0)
          return jsonResponse({
            currency: "EUR",
            asOfDate: "2026-09-21",
            streamVersion: 7,
            complete: false,
            nextCursor: "next-batch",
            items: [
              {
                horseId: "horse-retired",
                incomeMinor: 10000,
                expenseMinor: 4000,
                netMinor: 6000,
              },
            ],
          });
        return jsonResponse({
          currency: "EUR",
          asOfDate: "2026-09-21",
          streamVersion: 8,
          complete: true,
          nextCursor: null,
          items: [
            {
              horseId: "horse-retired",
              incomeMinor: 11000,
              expenseMinor: 5000,
              netMinor: 6000,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(wrapped(<ReportsRoute />, fetchImpl));
    await screen.findByRole("button", {
      name: "Load remaining lifetime results",
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Load remaining lifetime results" }),
    );
    expect(
      await screen.findByText("The report changed. Reload it."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Total income")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Restart lifetime report" }),
    );
    expect(
      await screen.findByRole("table", { name: "Lifetime totals" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("€110.00").length).toBeGreaterThan(0);
    expect(cursorCalls).toBe(1);
  });
});

test("horse detail includes monthly and complete lifetime financial summary, including inactive horses", async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  fetchImpl.mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/auth/session")
      return jsonResponse({
        user: { id: "owner-a" },
        accessToken: "token-a",
        csrfToken: "csrf-a",
      });
    if (url === "/api/v1/account")
      return jsonResponse({
        currency: "EUR",
        timeZone: "Europe/Berlin",
        ownerToday: "2026-09-21",
        streamVersion: 7,
      });
    if (url === "/api/v1/horses/horse-retired")
      return jsonResponse({
        horseId: "horse-retired",
        name: "Misty",
        breed: "Arabian",
        dateOfBirth: "2015-01-01",
        status: "Retired",
        streamVersion: 7,
      });
    if (url.startsWith("/api/v1/history?"))
      return jsonResponse({ items: [], nextCursor: null, streamVersion: 7 });
    if (url.startsWith("/api/v1/reports/monthly-pnl?"))
      return jsonResponse({
        currency: "EUR",
        month: "2026-09",
        streamVersion: 7,
        items: [
          {
            horseId: "horse-retired",
            incomeMinor: 10000,
            expenseMinor: 4000,
            netMinor: 6000,
          },
        ],
      });
    if (url.startsWith("/api/v1/reports/lifetime?"))
      return jsonResponse({
        currency: "EUR",
        asOfDate: "2026-09-21",
        streamVersion: 7,
        complete: true,
        nextCursor: null,
        items: [
          {
            horseId: "horse-retired",
            incomeMinor: 50000,
            expenseMinor: 20000,
            netMinor: 30000,
          },
        ],
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  render(wrapped(<HorseDetailRoute horseId="horse-retired" />, fetchImpl));
  expect(
    await screen.findByRole("region", { name: "Financial summary" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Misty")).toBeInTheDocument();
  expect(
    await screen.findByText(
      (_text, element) =>
        element?.tagName === "P" &&
        element.textContent?.replaceAll("\n", "").trim() ===
          "Through 2026-09-21",
    ),
  ).toBeInTheDocument();
  expect(await screen.findByText("€500.00")).toBeInTheDocument();
  expect(screen.getByText("€300.00")).toBeInTheDocument();
});
