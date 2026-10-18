import { expect, test } from "@playwright/test";
import {
  connectLocalBackend,
  ensureLocalAccountAndHorse,
} from "./localBackend";

test("a second authenticated browser owner cannot see another owner's horse", async ({
  browser,
  page,
  request,
}) => {
  const horseName = `Private ${crypto.randomUUID()}`;
  const ownerA = await connectLocalBackend(page, "user_Fixture");
  const ownerAHorse = await ensureLocalAccountAndHorse(
    request,
    ownerA,
    horseName,
  );

  await page.goto("/horses");
  await expect(page.getByRole("link", { name: horseName })).toBeVisible();

  const secondContext = await browser.newContext();
  try {
    const secondPage = await secondContext.newPage();
    const ownerB = await connectLocalBackend(secondPage, "user_FixtureB");
    expect(ownerB.subject).toBe("user_FixtureB");

    await secondPage.goto("/horses");
    await expect(secondPage.getByText(horseName, { exact: true })).toHaveCount(
      0,
    );
    await expect(secondPage.getByText("No horses yet.")).toBeVisible();

    const foreignHorse = await request.get(
      new URL(
        `/api/v1/horses/${encodeURIComponent(ownerAHorse.horseId)}`,
        ownerB.apiUrl,
      ).toString(),
      { headers: { Authorization: `Bearer ${ownerB.accessToken}` } },
    );
    expect(foreignHorse.status()).toBe(404);
    expect(await foreignHorse.text()).not.toContain(horseName);

    const unknownHorseId = crypto.randomUUID();
    const unknownHorse = await request.get(
      new URL(`/api/v1/horses/${unknownHorseId}`, ownerB.apiUrl).toString(),
      { headers: { Authorization: `Bearer ${ownerB.accessToken}` } },
    );
    expect(unknownHorse.status()).toBe(404);

    await secondPage.goto(`/horses/${encodeURIComponent(ownerAHorse.horseId)}`);
    await expect(secondPage.getByRole("alert")).toHaveText("Horse not found.");
    await secondPage.goto(`/horses/${unknownHorseId}`);
    await expect(secondPage.getByRole("alert")).toHaveText("Horse not found.");
    await expect(
      secondPage.getByRole("link", { name: "Back to horses" }),
    ).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
