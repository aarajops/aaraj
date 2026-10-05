import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const webPort = 3190;
const apiPort = 3191;
const apiInternalUrl = `http://${host}:${apiPort}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production/**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://${host}:${webPort}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node e2e/mock-api.mjs",
      url: `${apiInternalUrl}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { PORT: String(apiPort), HOST: host },
    },
    {
      command: `pnpm exec next start --hostname ${host} --port ${webPort}`,
      url: `http://${host}:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_INTERNAL_URL: apiInternalUrl },
    },
  ],
});
