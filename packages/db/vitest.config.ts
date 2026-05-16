import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000, // testcontainers can be slow on cold start
    hookTimeout: 60000,
  },
});
