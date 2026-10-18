import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_WEB_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  // The isolated TestHost is a single mutable event store and the fixture
  // restart journey replaces that host; run browser journeys serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
