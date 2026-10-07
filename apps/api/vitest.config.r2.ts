import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: "./",
    include: ["test/r2-storage.live.test.ts"],
    testTimeout: 45_000,
  },
});
