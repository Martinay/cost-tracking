import type { ReactNode } from "react";
import { ExpensesRoute } from "../../src/routes/expenses";
import { IncomeRoute } from "../../src/routes/income";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthBoundary } from "../../src/auth/AuthBoundary";
import { createSubjectQueryLifecycle } from "../../src/api/queryKeys";
import { describe, expect, test, vi } from "vitest";
import {
  ApiError,
  SubjectChangedError,
  createApiClient,
  createAuthSessionBootstrap,
} from "../../src/api/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const sessionBody = (accessToken?: string, id = "owner-a") => ({
  user: { id },
  csrfToken: "csrf-a",
  ...(accessToken ? { accessToken } : {}),
});

async function setup() {
  const broker = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(sessionBody("old")));
  const session = createAuthSessionBootstrap({ fetchImpl: broker });
  await session.load();
  const transport = vi.fn<typeof fetch>();
  const client = createApiClient({
    fetchImpl: transport,
    getAccessToken: session.getAccessToken,
    refreshAccessToken: (token, subject) =>
      session.refreshAccessToken(token, subject),
  });
  await client.setSubject("owner-a");
  return { broker, session, transport, client };
}
const unauthorized = () =>
  json(
    { code: "unauthenticated", message: "Sign in", correlationId: "test" },
    401,
  );
const get = { subject: "owner-a", path: "/api/v1/account" } as const;

describe("session renewal during API requests", () => {
  test("renews an expired token and replays the exact command once", async () => {
    const { broker, transport, client } = await setup();
    broker
      .mockResolvedValueOnce(json(sessionBody()))
      .mockResolvedValueOnce(json(sessionBody("new")));
    transport
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json({ streamVersion: 3 }));
    const command = client.createCommand({
      subject: "owner-a",
      method: "POST",
      path: "/api/v1/horses",
      streamVersion: 2,
      body: { name: "Luna", breed: "", dateOfBirth: null, status: "Active" },
    });
    await expect(client.sendCommand(command)).resolves.toEqual({
      streamVersion: 3,
    });
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [, init] of transport.mock.calls) {
      expect(init?.body).toBe(command.body);
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
        command.idempotencyKey,
      );
      expect(new Headers(init?.headers).get("If-Match")).toBe('"2"');
    }
    expect(
      new Headers(transport.mock.calls[1][1]?.headers).get("Authorization"),
    ).toBe("Bearer new");
    expect(broker.mock.calls.map(([url]) => url)).toEqual([
      "/auth/session",
      "/auth/session",
      "/auth/refresh",
    ]);
  });

  test("shares renewal across concurrent 401s including a late response", async () => {
    const { broker, transport, client } = await setup();
    let release!: (response: Response) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    transport
      .mockResolvedValueOnce(unauthorized())
      .mockImplementation(async () => json({ currency: "EUR" }));
    broker
      .mockResolvedValueOnce(json(sessionBody()))
      .mockResolvedValueOnce(json(sessionBody("new")));
    const late = client.get(get);
    await client.get(get);
    release(unauthorized());
    await late;
    expect(broker).toHaveBeenCalledTimes(3);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  test("returns a retryable error on transient renewal failure and allows another attempt", async () => {
    const { broker, session, transport, client } = await setup();
    broker
      .mockResolvedValueOnce(json(sessionBody()))
      .mockResolvedValueOnce(json({}, 503));
    transport.mockResolvedValueOnce(unauthorized());
    await expect(client.get(get)).rejects.toMatchObject({ status: 503 });
    expect(await session.getAccessToken()).toBe("old");
    expect(transport).toHaveBeenCalledTimes(1);
    broker
      .mockResolvedValueOnce(json(sessionBody()))
      .mockResolvedValueOnce(json(sessionBody("new")));
    transport
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json({ currency: "EUR" }));
    await expect(client.get(get)).resolves.toEqual({ currency: "EUR" });
  });

  test("does not replay under another account's token", async () => {
    const { broker, transport, client } = await setup();
    broker.mockResolvedValueOnce(json(sessionBody("other-token", "owner-b")));
    transport.mockResolvedValueOnce(unauthorized());
    await expect(client.get(get)).rejects.toBeInstanceOf(SubjectChangedError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test("stops after one retry if authentication is still rejected", async () => {
    const { broker, transport, client } = await setup();
    broker
      .mockResolvedValueOnce(json(sessionBody()))
      .mockResolvedValueOnce(json(sessionBody("new")));
    transport.mockImplementation(async () => unauthorized());
    await expect(client.get(get)).rejects.toBeInstanceOf(ApiError);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

test("deduplicates simultaneous renewal and ignores its result after sign-out", async () => {
  const { broker, session } = await setup();
  let release!: (response: Response) => void;
  broker.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = session.refreshAccessToken("old");
  const second = session.refreshAccessToken("old");
  expect(second).toBe(first);
  session.clear();
  release(json(sessionBody("new")));
  await expect(first).rejects.toBeInstanceOf(SubjectChangedError);
  expect(await session.getAccessToken()).toBeNull();
  expect(broker).toHaveBeenCalledTimes(2);
});

async function mountBoundary(
  children: ReactNode = (
    <label>
      Draft
      <input aria-label="Draft" defaultValue="" />
    </label>
  ),
  prepareTransport?: (
    transport: ReturnType<typeof vi.fn<typeof fetch>>,
  ) => void,
) {
  const { broker, session, transport, client } = await setup();
  broker.mockResolvedValueOnce(json(sessionBody("old")));
  prepareTransport?.(transport);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const lifecycle = createSubjectQueryLifecycle(queryClient, client.setSubject);
  render(
    <QueryClientProvider client={queryClient}>
      <AuthBoundary
        apiBaseUrl=""
        apiClient={client}
        session={session}
        subjectLifecycle={lifecycle}
      >
        {children}
      </AuthBoundary>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Sign out" });
  return { broker, session, transport, client, queryClient, screen };
}

test("automatic transient renewal failure retains the draft and offers session retry", async () => {
  const user = userEvent.setup();
  const { broker, transport, client, screen } = await mountBoundary();
  await user.type(screen.getByLabelText("Draft"), "unsaved horse");
  broker
    .mockResolvedValueOnce(json(sessionBody()))
    .mockResolvedValueOnce(json({}, 503));
  transport.mockResolvedValueOnce(unauthorized());
  await act(async () => {
    await expect(client.get(get)).rejects.toMatchObject({ status: 503 });
  });
  expect(screen.getByLabelText("Draft")).toHaveValue("unsaved horse");
  expect(
    screen.getByRole("button", { name: "Retry session check" }),
  ).toBeVisible();
  broker
    .mockResolvedValueOnce(json(sessionBody()))
    .mockResolvedValueOnce(json(sessionBody("new")));
  await user.click(screen.getByRole("button", { name: "Retry session check" }));
  expect(await screen.findByRole("textbox", { name: "Draft" })).toHaveValue(
    "unsaved horse",
  );
});

test("terminal renewal failure clears private data and offers sign-in", async () => {
  const { broker, transport, client, queryClient, screen } =
    await mountBoundary();
  queryClient.setQueryData(["horses", "owner-a"], ["private horse"]);
  broker
    .mockResolvedValueOnce(json(sessionBody()))
    .mockResolvedValueOnce(unauthorized());
  transport.mockResolvedValueOnce(unauthorized());
  await act(async () => {
    await expect(client.get(get)).rejects.toBeInstanceOf(SubjectChangedError);
  });
  expect(await screen.findByRole("link", { name: "Sign in" })).toBeVisible();
  expect(screen.queryByLabelText("Draft")).not.toBeInTheDocument();
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(transport).toHaveBeenCalledTimes(1);
});

test("a late 401 cannot reuse another account's already loaded token", async () => {
  const { broker, session, transport, client } = await setup();
  let release!: (response: Response) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const request = client.get(get);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  broker.mockResolvedValueOnce(json(sessionBody("other-token", "owner-b")));
  await session.load();
  release(unauthorized());
  await expect(request).rejects.toBeInstanceOf(SubjectChangedError);
  expect(transport).toHaveBeenCalledTimes(1);
});

for (const kind of ["Expense", "Income", "Driving"] as const) {
  test(`${kind} route retains its financial draft and server preview after transient renewal failure`, async () => {
    const user = userEvent.setup();
    let rejectAccount = false;
    const amountMinor = kind === "Driving" ? 300 : 1001;
    const { broker, client, transport, queryClient } = await mountBoundary(
      kind === "Income" ? <IncomeRoute /> : <ExpensesRoute />,
      (transport) =>
        transport.mockImplementation(async (input, init) => {
          const url = String(input);
          if (url === "/api/v1/account") {
            if (rejectAccount) {
              rejectAccount = false;
              return unauthorized();
            }
            return json({
              currency: "EUR",
              timeZone: "UTC",
              ownerToday: "2026-09-21",
              streamVersion: 7,
              drivingRateMinorPerKm: 30,
              settingsLocked: false,
            });
          }
          if (url === "/api/v1/horses")
            return json({
              items: [{ horseId: "horse-a", name: "Misty", status: "Active" }],
              nextCursor: null,
              streamVersion: 7,
            });
          if (url === "/api/v1/previews/financial")
            return json({
              currency: "EUR",
              date: "2026-09-21",
              amountMinor,
              splitMode: "Equal",
              allocations: [
                { horseId: "horse-a", weight: 1000000, amountMinor },
              ],
              monthlyEffect: [],
              streamVersion: 7,
              ...(kind === "Driving"
                ? {
                    driving: {
                      kilometers: 10,
                      rateMinorPerKm: 30,
                      amountMinor,
                    },
                  }
                : {}),
            });
          if (init?.method && init.method !== "GET")
            throw new Error(`Unexpected mutation: ${url}`);
          return json({
            items: [],
            nextCursor: null,
            streamVersion: 7,
            complete: true,
            currency: "EUR",
          });
        }),
    );
    const label = kind === "Driving" ? "driving expense" : kind.toLowerCase();
    await user.click(screen.getByRole("button", { name: `Record ${label}` }));
    const amountLabel = kind === "Driving" ? "Distance (km)" : "Amount";
    await user.type(
      await screen.findByLabelText(amountLabel),
      kind === "Driving" ? "10" : "10.01",
    );
    if (kind === "Expense") {
      await user.selectOptions(screen.getByLabelText("Category"), "Feed");
      await user.type(screen.getByLabelText("Description"), "Unsaved feed");
    } else if (kind === "Income") {
      await user.type(screen.getByLabelText("Source"), "Unsaved payment");
    } else {
      await user.type(screen.getByLabelText("Description"), "Unsaved trip");
    }
    await user.click(screen.getByLabelText("Misty"));
    await user.click(screen.getByRole("button", { name: `Preview ${label}` }));
    const previewName =
      kind === "Driving" ? "Driving expense preview" : `${kind} preview`;
    const preview = await screen.findByRole("region", { name: previewName });
    const previewText = preview.textContent;
    rejectAccount = true;
    broker
      .mockResolvedValueOnce(json(sessionBody()))
      .mockResolvedValueOnce(json({}, 503));
    await act(async () => {
      await expect(client.get(get)).rejects.toMatchObject({ status: 503 });
    });
    expect(
      screen.getByRole("button", { name: "Retry session check" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: previewName }),
    ).not.toBeInTheDocument();
    const pausedCalls = transport.mock.calls.length;
    await act(async () => {
      await Promise.resolve();
    });
    expect(transport).toHaveBeenCalledTimes(pausedCalls);
    broker
      .mockResolvedValueOnce(json(sessionBody()))
      .mockResolvedValueOnce(json(sessionBody("new")));
    await user.click(
      screen.getByRole("button", { name: "Retry session check" }),
    );
    expect(await screen.findByLabelText(amountLabel)).toHaveValue(
      kind === "Driving" ? 10 : 10.01,
    );
    expect(screen.getByLabelText("Misty")).toBeChecked();
    if (kind === "Expense") {
      expect(screen.getByLabelText("Category")).toHaveValue("Feed");
      expect(screen.getByLabelText("Description")).toHaveValue("Unsaved feed");
    } else if (kind === "Income")
      expect(screen.getByLabelText("Source")).toHaveValue("Unsaved payment");
    else
      expect(screen.getByLabelText("Description")).toHaveValue("Unsaved trip");
    expect(
      (await screen.findByRole("region", { name: previewName })).textContent,
    ).toBe(previewText);
    expect(screen.getByRole("button", { name: `Save ${label}` })).toBeEnabled();
    expect(
      transport.mock.calls.filter(
        ([url]) => url === "/api/v1/previews/financial",
      ),
    ).toHaveLength(1);
    rejectAccount = true;
    broker
      .mockResolvedValueOnce(json(sessionBody()))
      .mockResolvedValueOnce(unauthorized());
    await act(async () => {
      await expect(client.get(get)).rejects.toBeInstanceOf(SubjectChangedError);
    });
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByLabelText(amountLabel)).not.toBeInTheDocument();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
}
