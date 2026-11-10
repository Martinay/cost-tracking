import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  createApiClient,
  createAuthSessionBootstrap,
} from "../../src/api/client";
import { createSubjectQueryLifecycle } from "../../src/api/queryKeys";
import { AuthBoundary } from "../../src/auth/AuthBoundary";
import { SettingsRoute } from "../../src/routes/settings";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(timeZone: string | null = "Europe/Berlin", locked = false) {
  const account = {
    currency: "EUR",
    timeZone,
    settingsLocked: locked,
    streamVersion: 1,
  };
  const save = vi
    .fn<(body: unknown) => Promise<Response>>()
    .mockImplementation(async (body) =>
      json({ ...account, ...(body as object), streamVersion: 2 }),
    );
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input, init) => {
      if (String(input) === "/auth/session")
        return json({
          user: { id: "owner-settings" },
          accessToken: "test-token",
          csrfToken: "test-csrf",
        });
      if (String(input) === "/api/v1/account")
        return init?.method === "PUT"
          ? save(JSON.parse(String(init.body)))
          : json(account);
      if (String(input) === "/api/v1/history")
        return json({ items: [], streamVersion: 1, nextCursor: null });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
  const session = createAuthSessionBootstrap({ fetchImpl });
  const apiClient = createApiClient({
    fetchImpl,
    getAccessToken: session.getAccessToken,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthBoundary
        apiBaseUrl=""
        apiClient={apiClient}
        session={session}
        subjectLifecycle={createSubjectQueryLifecycle(
          queryClient,
          apiClient.setSubject,
        )}
      >
        <SettingsRoute />
      </AuthBoundary>
    </QueryClientProvider>,
  );
  return { save };
}

test.each([false, true])(
  "uses automatic ledger defaults without preference controls (locked=%s)",
  async (locked) => {
    const { save } = setup("UTC", locked);
    expect(
      await screen.findByText("All income and expenses use euros (EUR)."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Timestamps are stored in UTC and shown in your browser’s local time.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Time zone" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Currency" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save driving rate" }),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  },
);
