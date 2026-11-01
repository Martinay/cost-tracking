import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

test("offers worldwide zones and UTC, saves the selected identifier and announces success", async () => {
  const { save } = setup();
  const select = await screen.findByRole("combobox", { name: "Time zone" });
  expect(select).toHaveValue("Europe/Berlin");
  expect(select).toHaveAccessibleDescription(
    "Dates and recurring schedules follow this time zone.",
  );
  for (const zone of [
    "America/New_York",
    "Asia/Tokyo",
    "Africa/Cairo",
    "Australia/Sydney",
    "UTC",
  ]) {
    expect(screen.getByRole("option", { name: zone })).toBeInTheDocument();
  }
  await userEvent.selectOptions(select, "America/New_York");
  await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByText("Account settings saved.")).toHaveAttribute(
    "role",
    "status",
  );
  expect(save).toHaveBeenCalledWith({
    currency: "EUR",
    timeZone: "America/New_York",
  });
});

test("requires an explicit selection for an unconfigured account", async () => {
  setup(null);
  const select = await screen.findByRole("combobox", { name: "Time zone" });
  expect(select).toHaveValue("");
  expect(select).toBeRequired();
  expect(
    screen.getByRole("option", { name: "Select a time zone" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  await userEvent.selectOptions(select, "UTC");
  expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
});

test.each(["UTC", "US/Eastern"])(
  "preserves saved identifier %s even when absent from the runtime list",
  async (zone) => {
    setup(zone);
    expect(
      await screen.findByRole("combobox", { name: "Time zone" }),
    ).toHaveValue(zone);
    expect(screen.getAllByRole("option", { name: zone })).toHaveLength(1);
  },
);

test("disables the time zone for locked settings", async () => {
  setup("Europe/Berlin", true);
  expect(
    await screen.findByRole("combobox", { name: "Time zone" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Save settings" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Settings are locked after financial activity."),
  ).toBeInTheDocument();
});

test("disables during a pending save and retains the selection after failure for retry", async () => {
  const { save } = setup();
  let finish!: (response: Response) => void;
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const select = await screen.findByRole("combobox", { name: "Time zone" });
  await userEvent.selectOptions(select, "UTC");
  await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(select).toBeDisabled());
  finish(
    json(
      {
        code: "validation_failed",
        message: "Please retry.",
        correlationId: "test-error",
      },
      400,
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Please retry.");
  expect(select).toHaveValue("UTC");
  expect(select).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(
    await screen.findByText("Account settings saved."),
  ).toBeInTheDocument();
  expect(save).toHaveBeenLastCalledWith({ currency: "EUR", timeZone: "UTC" });
});
