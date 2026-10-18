import { expect, test } from "@playwright/test";

test("isolated API fixture is ready and the web shell loads", async ({
  page,
  request,
}) => {
  const apiUrl = process.env.E2E_API_URL;
  expect(
    apiUrl,
    "E2E_API_URL must be supplied by scripts/run-e2e.mjs",
  ).toBeTruthy();

  const health = await request.get(
    new URL("/__fixture/health", apiUrl).toString(),
  );
  expect(health.ok()).toBe(true);
  await expect(health).toBeOK();
  expect(await health.json()).toEqual({ ready: true });

  await page.goto("/");
  await expect(page).toHaveTitle("Horse ledger");
});

test("fixture session remains valid in the browser after an isolated host restart", async ({
  page,
}) => {
  const apiUrl = process.env.E2E_API_URL;
  const webUrl = process.env.E2E_WEB_URL;
  expect(
    apiUrl,
    "E2E_API_URL must be supplied by scripts/run-e2e.mjs",
  ).toBeTruthy();
  expect(
    webUrl,
    "E2E_WEB_URL must be supplied by scripts/run-e2e.mjs",
  ).toBeTruthy();
  await page.goto(webUrl!);

  const fixtureSession = await page.evaluate(async (apiOrigin) => {
    const created = await fetch(`${apiOrigin}/__fixture/session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!created.ok)
      throw new Error(`Fixture session failed: ${created.status}`);
    return (await created.json()) as { subject: string };
  }, apiUrl!);
  expect(fixtureSession.subject).toBe("user_Fixture");

  await page.goto(new URL("/__fixture/health", apiUrl!).toString());
  const before = await page.evaluate(async () => {
    const response = await fetch("/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Session lookup failed: ${response.status}`);
    const session = (await response.json()) as { user: { id: string } };
    return session.user.id;
  });
  expect(before).toBe(fixtureSession.subject);

  await page.goto(webUrl!);
  const restart = await page.evaluate(async (apiOrigin) => {
    const response = await fetch(`${apiOrigin}/__fixture/restart`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return { ok: response.ok, status: response.status };
  }, apiUrl!);
  expect(restart.ok, `fixture restart failed with ${restart.status}`).toBe(
    true,
  );

  await page.goto(new URL("/__fixture/health", apiUrl!).toString());
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch("/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { user: { id: string } };
        return body.user.id;
      }),
    )
    .toBe(before);
});
