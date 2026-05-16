import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Individual tests should be fast; a long testTimeout would hide hung queries.
    testTimeout: 10_000,
    // Hooks (beforeAll) include cold container pull on first run; keep generous.
    hookTimeout: 90_000,
  },
});
