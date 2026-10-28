import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const webPort = 3190;
const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const standaloneWebDir = `${distDir}/standalone/apps/web`;
const standaloneBuildDir = `${standaloneWebDir}/${distDir}`;
const apiInternalUrl = process.env.API_INTERNAL_URL ?? `http://${host}:3001`;
const configuredApiPort = new URL(apiInternalUrl).port;
const apiPort = Number(configuredApiPort || 3001);

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
      command: `mkdir -p ${standaloneBuildDir}/static ${standaloneWebDir}/public && cp -a ${distDir}/static/. ${standaloneBuildDir}/static/ && if [ -d public ]; then cp -a public/. ${standaloneWebDir}/public/; fi && node ${standaloneWebDir}/server.js`,
      url: `http://${host}:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "production",
        HOSTNAME: host,
        PORT: String(webPort),
        API_INTERNAL_URL: apiInternalUrl,
        CLIENT_URL: "https://aaraj.invalid",
      },
    },
  ],
});
