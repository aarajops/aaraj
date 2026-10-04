import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: "./",
    include: ["**/*.e2e-spec.ts"],
    setupFiles: ["./test/setup-e2e.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    sequence: { hooks: "stack" },
  },
});
