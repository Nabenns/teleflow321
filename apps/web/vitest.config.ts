import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/_helpers/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
