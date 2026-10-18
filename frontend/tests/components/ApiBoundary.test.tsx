import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ApiError,
  createApiClient,
  createAuthSessionBootstrap,
} from "../../src/api/client";
import {
  createQueryKeys,
  createSubjectQueryLifecycle,
} from "../../src/api/queryKeys";
import { AppShell, useAuthBoundary } from "../../src/components/AppShell";

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

describe("authenticated API boundary", () => {
  test("scopes every request and cache key to the active subject", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ streamVersion: 3 }));
    const client = createApiClient({
      getAccessToken: async () => "memory-token",
      fetchImpl,
    });
    await client.setSubject("owner-a");

    await client.get({ subject: "owner-a", path: "/api/v1/account" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/account",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("Authorization")).toBe(
      "Bearer memory-token",
    );
    expect(createQueryKeys("owner-a").account).toEqual(["account", "owner-a"]);
    expect(createQueryKeys("owner-b").account).toEqual(["account", "owner-b"]);
  });

  test("rejects unsafe integer values even when a response claims a generated int64 type", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ currency: "EUR", streamVersion: 9_007_199_254_740_992 }),
      );
    const client = createApiClient({
      getAccessToken: async () => "memory-token",
      fetchImpl,
    });
    await client.setSubject("owner-a");

    await expect(
      client.get({ subject: "owner-a", path: "/api/v1/account" }),
    ).rejects.toThrow("unsafe integer");
  });

  test("rejects responses from a previous subject after the subject changes", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const client = createApiClient({
      getAccessToken: async () => "memory-token",
      fetchImpl,
    });
    await client.setSubject("owner-a");
    const pending = client.get({ subject: "owner-a", path: "/api/v1/horses" });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await client.setSubject("owner-b");
    resolveRequest(jsonResponse({ items: ["owner-a horse"] }));

    await expect(pending).rejects.toMatchObject({
      name: "SubjectChangedError",
    });
  });

  test("rejects JSON parsed after the active subject has changed", async () => {
    let resolveJson!: (body: unknown) => void;
    let jsonStarted = false;
    const response = {
      ok: true,
      status: 200,
      json: () => {
        jsonStarted = true;
        return new Promise((resolve) => {
          resolveJson = resolve;
        });
      },
    } as Response;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = createApiClient({
      getAccessToken: async () => "memory-token",
      fetchImpl,
    });
    await client.setSubject("owner-a");
    const pending = client.get({ subject: "owner-a", path: "/api/v1/horses" });
    await waitFor(() => expect(jsonStarted).toBe(true));
    await client.setSubject("owner-b");
    resolveJson({ items: ["owner-a horse"] });

    await expect(pending).rejects.toMatchObject({
      name: "SubjectChangedError",
    });
  });

  test("retries an ambiguous command with its original body, idempotency key, and If-Match", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("connection lost after send"))
      .mockResolvedValueOnce(jsonResponse({ streamVersion: 8 }));
    const client = createApiClient({
      getAccessToken: async () => "memory-token",
      fetchImpl,
    });
    await client.setSubject("owner-a");
    const body = {
      expenseDate: "2026-10-08",
      amountMinor: 1001,
      category: "Feed",
      description: "",
      split: { mode: "Equal" as const, horseIds: ["horse-a"] },
    };
    const command = client.createCommand({
      subject: "owner-a",
      method: "POST",
      path: "/api/v1/expenses",
      body,
      streamVersion: 7,
      idempotencyKey: "a1871907-0d49-4e1b-b15a-a95316e76e48",
    });

    await expect(client.sendCommand(command)).rejects.toThrow(
      "connection lost",
    );
    await client.sendCommand(command);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/v1/expenses",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/v1/expenses",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    for (const [, init] of fetchImpl.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Idempotency-Key")).toBe(command.idempotencyKey);
      expect(headers.get("If-Match")).toBe('"7"');
    }
  });

  test("remembers the greatest stream version and discards cursors from older versions", async () => {
    const client = createApiClient({
      getAccessToken: async () => "memory-token",
      fetchImpl: vi.fn(),
    });
    await client.setSubject("owner-a");

    expect(client.rememberVersion("owner-a", 12)).toBe(12);
    expect(client.rememberVersion("owner-a", 9)).toBe(12);
    expect(client.lastSeenVersion("owner-a")).toBe(12);
    expect(
      client.cursorForVersion("opaque-cursor", 11, "owner-a"),
    ).toBeUndefined();
    expect(client.cursorForVersion("opaque-cursor", 12, "owner-a")).toBe(
      "opaque-cursor",
    );
  });

  test("cancels and clears cached data when the authenticated subject changes", async () => {
    const queryClient = new QueryClient();
    const setApiSubject = vi
      .fn<(subject: string | null) => Promise<void>>()
      .mockResolvedValue();
    const lifecycle = createSubjectQueryLifecycle(queryClient, setApiSubject);
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    queryClient.setQueryData(["horses", "owner-a", {}], ["private horse"]);

    await lifecycle.setSubject("owner-a");
    await lifecycle.setSubject("owner-b");

    expect(setApiSubject).toHaveBeenNthCalledWith(1, "owner-a");
    expect(setApiSubject).toHaveBeenNthCalledWith(2, "owner-b");
    expect(cancelQueries).toHaveBeenCalled();
    expect(queryClient.getQueryData(["horses", "owner-a", {}])).toBeUndefined();
    expect(queryClient.getQueryData(["horses", "owner-b", {}])).toBeUndefined();
    await lifecycle.setSubject(null);
    expect(setApiSubject).toHaveBeenLastCalledWith(null);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  test("turns server error DTOs into a typed recoverable error without exposing auth data", async () => {
    const client = createApiClient({
      getAccessToken: async () => "never-in-error",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            code: "version_conflict",
            message: "Refresh and review your draft before retrying.",
            correlationId: "corr-123",
            streamVersion: 9,
            details: [{ field: "amountMinor", message: "The amount changed." }],
          },
          409,
        ),
      ),
    });
    await client.setSubject("owner-a");

    const request = client.get({ subject: "owner-a", path: "/api/v1/account" });
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      code: "version_conflict",
      correlationId: "corr-123",
      streamVersion: 9,
      details: [{ field: "amountMinor", message: "The amount changed." }],
    });
    await expect(request).rejects.not.toThrow("never-in-error");
  });

  test("does not keep tokens or financial data in browser storage", async () => {
    const token = "memory-only-token";
    const client = createApiClient({
      getAccessToken: async () => token,
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ amountMinor: 1001 })),
    });
    await client.setSubject("owner-a");
    await client.get({ subject: "owner-a", path: "/api/v1/expenses" });

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(JSON.stringify(client)).not.toContain(token);
    expect(JSON.stringify(window.localStorage)).not.toContain("amountMinor");
  });

  test("boots an authenticated subject from the cookie session without persisting its access token", async () => {
    const token = "session-access-token";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        user: { id: "owner-a" },
        accessToken: token,
        expiresAt: "2026-10-08T18:00:00Z",
        csrfToken: "csrf-memory-only",
      }),
    );
    const session = createAuthSessionBootstrap({
      fetchImpl,
      baseUrl: "https://api.example.test",
    });

    const state = await session.load();

    expect(state).toMatchObject({ authReady: true, subject: "owner-a" });
    expect(await session.getAccessToken()).toBe(token);
    expect(session.getCsrfToken()).toBe("csrf-memory-only");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/auth/session",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  test("treats a missing cookie session as a ready signed-out state", async () => {
    const session = createAuthSessionBootstrap({
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 401 })),
    });

    expect(await session.load()).toMatchObject({
      authReady: true,
      subject: null,
    });
    expect(await session.getAccessToken()).toBeNull();
    expect(session.getCsrfToken()).toBeNull();
  });

  test("refreshes a session response that omits its access token using its in-memory CSRF token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "owner-a" },
          expiresAt: "2026-10-08T18:00:00Z",
          csrfToken: "csrf-memory-only",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "owner-a" },
          accessToken: "refreshed-token",
          expiresAt: "2026-10-08T18:30:00Z",
        }),
      );
    const session = createAuthSessionBootstrap({ fetchImpl });

    expect(await session.load()).toMatchObject({
      authReady: true,
      subject: "owner-a",
    });
    expect(await session.getAccessToken()).toBe("refreshed-token");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/auth/refresh",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "X-CSRF-Token": "csrf-memory-only" },
      }),
    );
  });
});

describe("application shell", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test("announces auth loading and exposes named primary navigation when ready", async () => {
    const { rerender } = render(
      <AppShell authReady={false} subject={null}>
        Private content
      </AppShell>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /loading your account/i,
    );
    rerender(
      <AppShell authReady subject="owner-a">
        Private content
      </AppShell>,
    );
    expect(
      await screen.findByRole("navigation", { name: /primary/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Horses" })).toHaveAttribute(
      "href",
      "/horses",
    );
    expect(screen.getByRole("link", { name: "Expenses" })).toHaveAttribute(
      "href",
      "/expenses",
    );
    expect(screen.getByRole("main")).toHaveTextContent("Private content");
  });

  test("keeps a local draft while protected queries stay idle until auth is ready", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryFn = vi.fn().mockResolvedValue(["private horse"]);
    function ProtectedForm() {
      const { authReady, subject } = useAuthBoundary();
      const query = useQuery({
        queryKey: ["horses", subject],
        queryFn,
        enabled: authReady && subject !== null,
      });
      return (
        <>
          <label>
            Amount
            <input aria-label="Amount" defaultValue="10.01" />
          </label>
          <span>Query fetch state: {query.fetchStatus}</span>
        </>
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell authReady={false} subject="owner-a">
          <ProtectedForm />
        </AppShell>
      </QueryClientProvider>,
    );

    expect(queryFn).not.toHaveBeenCalled();
    expect(screen.getByText("Query fetch state: idle")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toHaveValue("10.01");
    expect(screen.getByLabelText("Amount")).not.toBeVisible();
  });

  test("keeps child form state mounted during transient auth loading and announces errors", async () => {
    function DraftForm() {
      const { authReady } = useAuthBoundary();
      return (
        <>
          <label>
            Amount
            <input aria-label="Amount" defaultValue="10.01" />
          </label>
          <span>Auth ready: {String(authReady)}</span>
        </>
      );
    }
    const { rerender } = render(
      <AppShell
        authReady
        subject="owner-a"
        statusMessage="Saving expense"
        statusKind="polite"
      >
        <DraftForm />
      </AppShell>,
    );
    await userEvent.clear(screen.getByRole("textbox", { name: "Amount" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Amount" }),
      "12.34",
    );
    rerender(
      <AppShell
        authReady={false}
        subject="owner-a"
        statusMessage="Could not save. Retry with the same request."
        statusKind="assertive"
      >
        <DraftForm />
      </AppShell>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Amount")).toHaveValue("12.34"),
    );
    expect(screen.getByLabelText("Amount")).not.toBeVisible();
    expect(screen.getByText("Auth ready: false")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not save/i);
    expect(screen.getByRole("status")).toHaveTextContent(
      /loading your account/i,
    );
  });

  test("discards an in-memory form draft when the active subject changes", async () => {
    function DraftForm() {
      return (
        <label>
          Amount
          <input aria-label="Amount" defaultValue="10.01" />
        </label>
      );
    }
    const { rerender } = render(
      <AppShell authReady subject="owner-a">
        <DraftForm />
      </AppShell>,
    );
    await userEvent.clear(screen.getByRole("textbox", { name: "Amount" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Amount" }),
      "12.34",
    );
    rerender(
      <AppShell authReady subject="owner-b">
        <DraftForm />
      </AppShell>,
    );

    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue(
      "10.01",
    );
  });
});

test("protected UI can be deferred until auth is ready without changing its draft", () => {
  const queryClient = new QueryClient();
  const lifecycle = createSubjectQueryLifecycle(queryClient);
  expect(lifecycle.subject).toBeNull();
  expect(
    createQueryKeys("owner-a").expenses({
      from: "2026-10-01",
      to: "2026-10-31",
    }),
  ).toEqual(["expenses", "owner-a", "2026-10-01", "2026-10-31", {}]);
});
