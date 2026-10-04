import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const webPort = 3180;
const apiPort = 3181;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "integration/**/*.spec.ts",
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
      command: "pnpm --filter @aaraj/api run e2e:server",
      url: `http://${host}:${apiPort}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: String(apiPort), HOST: host },
    },
    {
      command: `pnpm exec next dev --hostname ${host} --port ${webPort}`,
      url: `http://${host}:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_INTERNAL_URL: `http://${host}:${apiPort}`,
        NEXT_DIST_DIR: ".next-e2e-integration",
      },
    },
  ],
});
