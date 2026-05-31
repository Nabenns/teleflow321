import { defineConfig } from "@playwright/test";

// Port for the in-process mock Telegram Bot API server (see e2e/_telegram-mock.ts).
// The dev server is pointed at it via TELEGRAM_API_BASE_URL so the server-side
// getMe/setWebhook calls in lib/telegram/client.ts hit the mock instead of the
// live api.telegram.org — page.route only intercepts browser traffic and cannot
// touch fetches made inside the Next.js process.
const TELEGRAM_MOCK_PORT = 3099;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  globalSetup: "./e2e/_telegram-mock.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @lapakgram/web dev",
    port: 3000,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL:
        "postgres://lapakgram:lapakgram_dev@localhost:5434/lapakgram_e2e",
      MASTER_ENCRYPTION_KEY:
        process.env.MASTER_ENCRYPTION_KEY ??
        "ZGV2X29ubHlfMzJfYnl0ZV9rZXlfZG9fbm90X3VzZSE=",
      INVITE_SIGNING_SECRET:
        process.env.INVITE_SIGNING_SECRET ??
        "ZGV2X29ubHlfaW52aXRlX3NpZ25pbmdfa2V5XzMyXyE=",
      NEXTAUTH_SECRET: "e2e_test_secret_minimum_32_bytes_long",
      NEXTAUTH_URL: "http://localhost:3000",
      // Route all server-side Telegram Bot API calls to the local mock.
      TELEGRAM_API_BASE_URL: `http://localhost:${TELEGRAM_MOCK_PORT}`,
    },
  },
});

export { TELEGRAM_MOCK_PORT };
