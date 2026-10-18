import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  createApiClient,
  createAuthSessionBootstrap,
  type AuthBootstrapState,
} from "../../src/api/client";
import { createSubjectQueryLifecycle } from "../../src/api/queryKeys";
import { AuthBoundary, useAuthServices } from "../../src/auth/AuthBoundary";
import { AppShell, useAuthBoundary } from "../../src/components/AppShell";
import { HorseForm } from "../../src/features/horses/HorseForm";
import { SettingsRoute } from "../../src/routes/settings";
import { HorsesRoute } from "../../src/routes/horses";
import { HorseDetailRoute } from "../../src/routes/horses.$horseId";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function AuthenticatedContent({
  loadAccount,
}: {
  loadAccount: () => Promise<{ owner: string }>;
}) {
  const { authReady, subject } = useAuthBoundary();
  const account = useQuery({
    queryKey: ["account", subject],
    queryFn: loadAccount,
    enabled: authReady && subject !== null,
  });
  return (
    <>
      <label>
        Expense amount
        <input aria-label="Expense amount" defaultValue="10.01" />
      </label>
      <output>
        Account owner: {account.data?.owner ?? account.fetchStatus}
      </output>
    </>
  );
}

function SignOutControl() {
  const { subject, signOut } = useAuthServices();
  return (
    <button onClick={() => void signOut()} type="button">
      Sign out {subject}
    </button>
  );
}

function TestApp({
  state,
  queryClient,
  loadAccount,
}: {
  state: AuthBootstrapState;
  queryClient: QueryClient;
  loadAccount: () => Promise<{ owner: string }>;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell
        authReady={state.authReady}
        subject={state.subject}
        statusMessage={state.statusMessage}
        statusKind={state.statusKind}
        authFallback={<p>Sign in required</p>}
      >
        <AuthenticatedContent loadAccount={loadAccount} />
      </AppShell>
    </QueryClientProvider>
  );
}

describe("auth boundary recovery", () => {
  test("keeps a form draft and current account during a transient session refresh failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
          expiresAt: "2026-10-08T18:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "temporarily unavailable" }, 503),
      );
    const session = createAuthSessionBootstrap({ fetchImpl });
    const state = await session.load();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(queryClient);
    await lifecycle.setSubject(state.subject);
    const loadAccount = vi.fn().mockResolvedValue({ owner: "owner-a" });
    const view = render(
      <TestApp
        state={state}
        queryClient={queryClient}
        loadAccount={loadAccount}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Account owner: owner-a")).toBeInTheDocument(),
    );
    await userEvent.clear(
      screen.getByRole("textbox", { name: "Expense amount" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Expense amount" }),
      "12.34",
    );

    const retryState = await session.load();
    await lifecycle.setSubject(retryState.subject);
    view.rerender(
      <TestApp
        state={retryState}
        queryClient={queryClient}
        loadAccount={loadAccount}
      />,
    );

    expect(retryState).toMatchObject({ authReady: false, subject: "owner-a" });
    expect(screen.getByLabelText("Expense amount")).toHaveValue("12.34");
    expect(screen.getByLabelText("Expense amount")).not.toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /check your connection and retry/i,
    );
    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["account", "owner-a"])).toEqual({
      owner: "owner-a",
    });
    expect(await session.getAccessToken()).toBe("token-a");
  });

  test("clears subject data and mounted drafts after the cookie session ends", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
          expiresAt: "2026-10-08T18:00:00Z",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const session = createAuthSessionBootstrap({ fetchImpl });
    const firstState = await session.load();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(queryClient);
    await lifecycle.setSubject(firstState.subject);
    const loadAccount = vi.fn().mockResolvedValue({ owner: "owner-a" });
    const { rerender } = render(
      <TestApp
        state={firstState}
        queryClient={queryClient}
        loadAccount={loadAccount}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Account owner: owner-a")).toBeInTheDocument(),
    );
    await userEvent.clear(
      screen.getByRole("textbox", { name: "Expense amount" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Expense amount" }),
      "12.34",
    );

    const signedOut = await session.load();
    await lifecycle.setSubject(signedOut.subject);
    rerender(
      <TestApp
        state={signedOut}
        queryClient={queryClient}
        loadAccount={loadAccount}
      />,
    );

    expect(signedOut).toMatchObject({
      authReady: true,
      subject: null,
      signInRequired: true,
    });
    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(screen.queryByLabelText("Expense amount")).not.toBeInTheDocument();
    expect(queryClient.getQueryData(["account", "owner-a"])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await session.getAccessToken()).toBeNull();
  });

  test("does not persist an access token and ignores a stale owner response after switching subjects", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const client = createApiClient({
      getAccessToken: async () => "token-a",
      fetchImpl,
    });
    await client.setSubject("owner-a");
    const request = client.get({ subject: "owner-a", path: "/api/v1/account" });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await client.setSubject("owner-b");
    resolveResponse(jsonResponse({ owner: "owner-a" }));

    await expect(request).rejects.toMatchObject({
      name: "SubjectChangedError",
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(JSON.stringify(client)).not.toContain("token-a");
  });
});

describe("horse form", () => {
  test("creates a registered horse with accessible fields and nullable birth date", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<HorseForm mode="create" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Name"), "Misty");
    await userEvent.type(screen.getByLabelText("Breed"), "Arabian");
    await userEvent.click(screen.getByRole("button", { name: "Save horse" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Misty",
      breed: "Arabian",
      dateOfBirth: null,
      status: "Active",
    });
  });

  test("requires a name and keeps status out of details-only editing", async () => {
    const onSubmit = vi.fn();
    const horse = {
      name: "Misty",
      breed: "Arabian",
      dateOfBirth: "2020-04-10",
      status: "Leased" as const,
    };
    const { unmount } = render(<HorseForm mode="create" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Save horse" }));
    expect(screen.getByLabelText("Name")).toBeInvalid();
    expect(onSubmit).not.toHaveBeenCalled();

    unmount();
    render(<HorseForm mode="edit" initialValue={horse} onSubmit={onSubmit} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Misty");
    expect(screen.getByLabelText("Breed")).toHaveValue("Arabian");
    expect(screen.getByLabelText("Date of birth")).toHaveValue("2020-04-10");
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });
});

describe("auth boundary sign-out", () => {
  test("posts with the memory-only CSRF token, clears subject data, and follows the server logout URL", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
          expiresAt: "2026-10-08T18:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ logoutUrl: "https://api.workos.com/logout" }),
      );
    const session = createAuthSessionBootstrap({
      fetchImpl,
      baseUrl: "https://api.example.test",
    });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient();
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    const navigate = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl="https://api.example.test"
          apiClient={client}
          navigate={navigate}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <SignOutControl />
        </AuthBoundary>
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Sign out owner-a" });
    queryClient.setQueryData(["horses", "owner-a"], ["private horse"]);

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out owner-a" }),
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.example.test/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-a" }),
      }),
    );
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await session.getAccessToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith("https://api.workos.com/logout");
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  test("clears private cache and hides protected content before the logout request settles", async () => {
    let finishLogout!: (response: Response) => void;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
          expiresAt: "2026-10-08T18:00:00Z",
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishLogout = resolve;
          }),
      );
    const session = createAuthSessionBootstrap({ fetchImpl });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient();
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    const navigate = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl=""
          apiClient={client}
          navigate={navigate}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <SignOutControl />
          <p>Private ledger content</p>
        </AuthBoundary>
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Sign out owner-a" });
    queryClient.setQueryData(["horses", "owner-a"], ["private horse"]);

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out owner-a" }),
    );

    expect(
      await screen.findByRole("link", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Private ledger content"),
    ).not.toBeInTheDocument();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    finishLogout(jsonResponse({ logoutUrl: "https://api.workos.com/logout" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://api.workos.com/logout"),
    );
  });
});

describe("first-use settings", () => {
  test("configures currency and time zone with command headers and announces acknowledgment", async () => {
    let configured = false;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "/auth/session")
          return jsonResponse({
            user: { id: "owner-a" },
            accessToken: "token-a",
            csrfToken: "csrf-a",
            expiresAt: "2026-10-08T18:00:00Z",
          });
        if (url === "/api/v1/history")
          return jsonResponse({
            items: [],
            nextCursor: null,
            streamVersion: configured ? 1 : 0,
          });
        if (url !== "/api/v1/account")
          throw new Error(`Unexpected request: ${url}`);
        if (init?.method === "PUT") {
          configured = true;
          return jsonResponse({
            currency: "EUR",
            timeZone: "Europe/Berlin",
            streamVersion: 1,
            drivingRateMinorPerKm: null,
            settingsLocked: false,
          });
        }
        return jsonResponse({
          currency: null,
          timeZone: null,
          streamVersion: 0,
          drivingRateMinorPerKm: null,
          settingsLocked: false,
        });
      });
    const session = createAuthSessionBootstrap({ fetchImpl });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl=""
          apiClient={client}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <SettingsRoute />
        </AuthBoundary>
      </QueryClientProvider>,
    );
    await screen.findByLabelText("Currency");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await userEvent.clear(screen.getByLabelText("Time zone"));
    await userEvent.type(screen.getByLabelText("Time zone"), "Europe/Berlin");
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );

    const commandCall = fetchImpl.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/v1/account" && init?.method === "PUT",
    );
    const [url, init] = commandCall ?? [];
    expect(url).toBe("/api/v1/account");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(
      JSON.stringify({ currency: "EUR", timeZone: "Europe/Berlin" }),
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("If-Match")).toBe('"0"');
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(
      await screen.findByText("Account settings saved."),
    ).toBeInTheDocument();
  });

  test("shows locked settings as read-only after financial activity", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
          expiresAt: "2026-10-08T18:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          currency: "EUR",
          timeZone: "Europe/Berlin",
          streamVersion: 4,
          drivingRateMinorPerKm: null,
          settingsLocked: true,
        }),
      );
    const session = createAuthSessionBootstrap({ fetchImpl });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl=""
          apiClient={client}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <SettingsRoute />
        </AuthBoundary>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(/settings are locked after financial activity/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Currency")).toBeDisabled();
    expect(screen.getByLabelText("Time zone")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save settings" }),
    ).not.toBeInTheDocument();
  });

  test("retries an ambiguous settings command with its captured body, version, and idempotency key", async () => {
    let commandAttempts = 0;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "/auth/session")
          return jsonResponse({
            user: { id: "owner-a" },
            accessToken: "token-a",
            csrfToken: "csrf-a",
            expiresAt: "2026-10-08T18:00:00Z",
          });
        if (url === "/api/v1/history")
          return jsonResponse({
            items: [],
            nextCursor: null,
            streamVersion: 6,
          });
        if (url !== "/api/v1/account")
          throw new Error(`Unexpected request: ${url}`);
        if (init?.method === "PUT") {
          commandAttempts += 1;
          if (commandAttempts === 1)
            return jsonResponse(
              {
                code: "temporarily_unavailable",
                message: "Try again.",
                correlationId: "trace-1",
              },
              503,
            );
          return jsonResponse({
            currency: "EUR",
            timeZone: "Europe/Berlin",
            streamVersion: 7,
            settingsLocked: false,
          });
        }
        return jsonResponse({
          currency: "EUR",
          timeZone: "Europe/Berlin",
          streamVersion: 6,
          settingsLocked: false,
        });
      });
    const session = createAuthSessionBootstrap({ fetchImpl });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl=""
          apiClient={client}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <SettingsRoute />
        </AuthBoundary>
      </QueryClientProvider>,
    );
    await screen.findByLabelText("Currency");
    await userEvent.clear(screen.getByLabelText("Time zone"));
    await userEvent.type(screen.getByLabelText("Time zone"), "Europe/Berlin");
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Berlin");
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    await screen.findByText("Account settings saved.");

    const commands = fetchImpl.mock.calls
      .filter(
        ([url, init]) =>
          String(url) === "/api/v1/account" && init?.method === "PUT",
      )
      .map(([, init]) => init!);
    expect(commands).toHaveLength(2);
    expect(commands[1].body).toBe(commands[0].body);
    expect(new Headers(commands[1].headers).get("If-Match")).toBe(
      new Headers(commands[0].headers).get("If-Match"),
    );
    expect(new Headers(commands[1].headers).get("Idempotency-Key")).toBe(
      new Headers(commands[0].headers).get("Idempotency-Key"),
    );
  });

  test("shows the owner-scoped chronological account history", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === "/auth/session")
          return jsonResponse({
            user: { id: "owner-a" },
            accessToken: "token-a",
            csrfToken: "csrf-a",
            expiresAt: "2026-10-08T18:00:00Z",
          });
        if (url === "/api/v1/account")
          return jsonResponse({
            currency: "EUR",
            timeZone: "Europe/Berlin",
            streamVersion: 2,
            settingsLocked: false,
          });
        if (url === "/api/v1/history")
          return jsonResponse({
            items: [
              {
                eventId: "account-event",
                streamVersion: 1,
                type: "AccountConfigured",
                occurredAt: "2026-10-08T16:00:00Z",
                summary: "Account settings updated",
                changes: { currency: "EUR", timeZone: "Europe/Berlin" },
              },
            ],
            nextCursor: null,
            streamVersion: 2,
          });
        throw new Error(`Unexpected request: ${url}`);
      });
    const session = createAuthSessionBootstrap({ fetchImpl });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl=""
          apiClient={client}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <SettingsRoute />
        </AuthBoundary>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Account history" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Account settings updated"),
    ).toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some(([url]) => String(url) === "/api/v1/history"),
    ).toBe(true);
  });
});

describe("horse management", () => {
  test("lists only the API-selected horses and offers setup without hiding inactive history", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "owner-a" },
          accessToken: "token-a",
          csrfToken: "csrf-a",
          expiresAt: "2026-10-08T18:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          currency: "EUR",
          timeZone: "Europe/Berlin",
          streamVersion: 1,
          settingsLocked: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              horseId: "active-id",
              name: "Misty",
              breed: "Arabian",
              dateOfBirth: null,
              status: "Active",
              streamVersion: 2,
            },
            {
              horseId: "sold-id",
              name: "Comet",
              breed: "Warmblood",
              dateOfBirth: null,
              status: "Sold",
              streamVersion: 2,
            },
          ],
          nextCursor: null,
          streamVersion: 2,
        }),
      );
    const session = createAuthSessionBootstrap({ fetchImpl });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl=""
          apiClient={client}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <HorsesRoute />
        </AuthBoundary>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Your horses" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Misty")).toBeInTheDocument();
    expect(screen.getByText("Comet")).toBeInTheDocument();
    expect(screen.getByText("Sold")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Misty" })).toHaveAttribute(
      "href",
      "/horses/active-id",
    );
    expect(
      screen.getByRole("button", { name: "Add horse" }),
    ).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "/api/v1/horses",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("updates horse details and status with separate versioned commands and retains history view", async () => {
    const horse = {
      horseId: "horse-id",
      name: "Misty",
      breed: "Arabian",
      dateOfBirth: null,
      status: "Active",
      streamVersion: 3,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "/auth/session")
          return jsonResponse({
            user: { id: "owner-a" },
            accessToken: "token-a",
            csrfToken: "csrf-a",
            expiresAt: "2026-10-08T18:00:00Z",
          });
        if (url.includes("/api/v1/history?"))
          return jsonResponse({
            items: [
              {
                eventId: "event-1",
                streamVersion: 2,
                type: "HorseRegistered",
                occurredAt: "2026-10-08T16:00:00Z",
                summary: "Horse registered",
                changes: {
                  horseId: "horse-id",
                  name: "Misty",
                  status: "Active",
                },
              },
            ],
            nextCursor: null,
            streamVersion: 3,
          });
        if (url.endsWith("/api/v1/horses/horse-id") && init?.method === "PATCH")
          return jsonResponse({
            ...horse,
            breed: "Arabian mix",
            streamVersion: 4,
          });
        if (url.endsWith("/api/v1/horses/horse-id/status"))
          return jsonResponse({
            ...horse,
            breed: "Arabian mix",
            status: "Retired",
            streamVersion: 5,
          });
        return jsonResponse(horse);
      });
    const session = createAuthSessionBootstrap({ fetchImpl });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl=""
          apiClient={client}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <HorseDetailRoute horseId="horse-id" />
        </AuthBoundary>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Misty" }),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Breed"));
    await userEvent.type(screen.getByLabelText("Breed"), "Arabian mix");
    await userEvent.click(screen.getByRole("button", { name: "Save horse" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      /horse details saved/i,
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Horse status"),
      "Retired",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Update status" }),
    );

    const detailsCall = fetchImpl.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/api/v1/horses/horse-id") &&
        init?.method === "PATCH",
    );
    const statusCall = fetchImpl.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/api/v1/horses/horse-id/status") &&
        init?.method === "PUT",
    );
    const detailsInit = detailsCall?.[1];
    const statusInit = statusCall?.[1];
    expect(detailsInit?.method).toBe("PATCH");
    expect(detailsInit?.body).toBe(
      JSON.stringify({
        name: "Misty",
        breed: "Arabian mix",
        dateOfBirth: null,
      }),
    );
    expect(statusInit?.method).toBe("PUT");
    expect(statusInit?.body).toBe(JSON.stringify({ status: "Retired" }));
    expect(
      screen.getByRole("heading", { name: /history/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Horse registered")).toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some(
        ([url]) => String(url) === "/api/v1/history?horseId=horse-id",
      ),
    ).toBe(true);
  });

  test("retries an ambiguous horse registration with the exact captured command", async () => {
    let createAttempts = 0;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "/auth/session")
          return jsonResponse({
            user: { id: "owner-a" },
            accessToken: "token-a",
            csrfToken: "csrf-a",
            expiresAt: "2026-10-08T18:00:00Z",
          });
        if (url === "/api/v1/account")
          return jsonResponse({
            currency: "EUR",
            timeZone: "Europe/Berlin",
            streamVersion: 1,
            settingsLocked: false,
          });
        if (url === "/api/v1/horses" && init?.method !== "POST")
          return jsonResponse({
            items: [],
            nextCursor: null,
            streamVersion: 1,
          });
        if (url === "/api/v1/horses" && init?.method === "POST") {
          createAttempts += 1;
          if (createAttempts === 1)
            return jsonResponse(
              {
                code: "temporarily_unavailable",
                message: "Try again.",
                correlationId: "trace-2",
              },
              503,
            );
          return jsonResponse({ horseId: "horse-new", streamVersion: 2 }, 201);
        }
        throw new Error(`Unexpected request: ${url}`);
      });
    const session = createAuthSessionBootstrap({ fetchImpl });
    const client = createApiClient({
      fetchImpl,
      getAccessToken: () => session.getAccessToken(),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const lifecycle = createSubjectQueryLifecycle(
      queryClient,
      client.setSubject,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl=""
          apiClient={client}
          session={session}
          subjectLifecycle={lifecycle}
        >
          <HorsesRoute />
        </AuthBoundary>
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Add horse" });
    await userEvent.click(screen.getByRole("button", { name: "Add horse" }));
    await userEvent.type(screen.getByLabelText("Name"), "Misty");
    await userEvent.type(screen.getByLabelText("Breed"), "Arabian");
    await userEvent.click(screen.getByRole("button", { name: "Save horse" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Name")).toHaveValue("Misty");
    await userEvent.click(screen.getByRole("button", { name: "Save horse" }));

    const commands = fetchImpl.mock.calls
      .filter(
        ([url, init]) =>
          String(url) === "/api/v1/horses" && init?.method === "POST",
      )
      .map(([, init]) => init!);
    expect(commands).toHaveLength(2);
    expect(commands[1].body).toBe(commands[0].body);
    expect(new Headers(commands[1].headers).get("If-Match")).toBe(
      new Headers(commands[0].headers).get("If-Match"),
    );
    expect(new Headers(commands[1].headers).get("Idempotency-Key")).toBe(
      new Headers(commands[0].headers).get("Idempotency-Key"),
    );
  });
});
