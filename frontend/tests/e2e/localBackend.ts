import type { APIRequestContext, Page } from "@playwright/test";

export interface LocalBackendSession {
  apiUrl: string;
  webUrl: string;
  subject: string;
  accessToken: string;
}

export async function connectLocalBackend(
  page: Page,
  subject = "user_FixtureB",
): Promise<LocalBackendSession> {
  const apiUrl = process.env.E2E_API_URL;
  const webUrl = process.env.E2E_WEB_URL;
  if (!apiUrl || !webUrl)
    throw new Error("The isolated E2E API and web origins are required.");

  await page.goto(webUrl);
  const fixtureSubject = await page.evaluate(
    async ({ apiOrigin, subject }) => {
      const response = await fetch(`${apiOrigin}/__fixture/session`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject }),
      });
      if (!response.ok)
        throw new Error(`Fixture session failed: ${response.status}`);
      return ((await response.json()) as { subject: string }).subject;
    },
    { apiOrigin: apiUrl, subject },
  );
  if (fixtureSubject !== subject)
    throw new Error(
      `Expected fixture subject ${subject}, got ${fixtureSubject}.`,
    );
  await page.goto(new URL("/__fixture/health", apiUrl).toString());
  const accessToken = await page.evaluate(async () => {
    const response = await fetch("/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Session lookup failed: ${response.status}`);
    return ((await response.json()) as { accessToken: string }).accessToken;
  });
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: subject },
        accessToken,
        csrfToken: "fixture-csrf",
      }),
    }),
  );
  // The TestHost's backend CORS policy is pinned to its HTTPS fixture origin.
  // This test-only proxy permits Vite browser journeys while forwarding actual
  // API requests and responses through Playwright to the isolated TestHost.
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": webUrl,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS",
          "Access-Control-Allow-Headers":
            "Authorization,Content-Type,Idempotency-Key,If-Match,X-CSRF-Token",
        },
      });
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "Access-Control-Allow-Origin": webUrl,
        "Access-Control-Allow-Credentials": "true",
      },
    });
  });
  return { apiUrl, webUrl, subject, accessToken };
}

export async function ensureLocalAccountAndHorse(
  request: APIRequestContext,
  session: LocalBackendSession,
  name: string,
) {
  const authorization = { Authorization: `Bearer ${session.accessToken}` };
  const accountUrl = new URL("/api/v1/account", session.apiUrl).toString();
  let response = await request.get(accountUrl, { headers: authorization });
  if (!response.ok())
    throw new Error(`Account lookup failed: ${response.status()}`);
  const account = (await response.json()) as {
    currency: string | null;
    streamVersion: number;
  };
  if (account.currency === null) {
    response = await request.put(accountUrl, {
      headers: {
        ...authorization,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": `"${account.streamVersion}"`,
      },
      data: { currency: "EUR", timeZone: "Europe/Berlin" },
    });
    if (!response.ok())
      throw new Error(`Account setup failed: ${response.status()}`);
  }

  const horsesUrl = new URL("/api/v1/horses", session.apiUrl).toString();
  response = await request.get(horsesUrl, { headers: authorization });
  if (!response.ok())
    throw new Error(`Horse lookup failed: ${response.status()}`);
  const horses = (await response.json()) as {
    items: { horseId: string; name: string }[];
    streamVersion: number;
  };
  const existing = horses.items.find((horse) => horse.name === name);
  if (existing) return { ...session, horseId: existing.horseId };

  response = await request.post(horsesUrl, {
    headers: {
      ...authorization,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      "If-Match": `"${horses.streamVersion}"`,
    },
    data: {
      name,
      breed: "Arabian",
      dateOfBirth: null,
      status: "Active",
    },
  });
  if (!response.ok())
    throw new Error(`Horse setup failed: ${response.status()}`);
  const created = (await response.json()) as { horseId: string };
  return { ...session, horseId: created.horseId };
}
