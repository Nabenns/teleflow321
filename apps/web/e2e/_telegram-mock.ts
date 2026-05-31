import { createServer, type Server } from "node:http";
import { TELEGRAM_MOCK_PORT } from "../playwright.config.js";

// Mock Telegram Bot API for the E2E run. The bot-setup server action calls
// getMe + setWebhook from inside the Next.js process; those fetches cannot be
// intercepted by Playwright's page.route (browser-only). We instead start a
// tiny HTTP server here and point the dev server at it via
// TELEGRAM_API_BASE_URL (set in playwright.config.ts webServer.env).
//
// Routes mirror the real Bot API path shape: /bot<token>/<method>.
let server: Server | undefined;

async function globalSetup(): Promise<() => Promise<void>> {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("Content-Type", "application/json");

    if (url.includes("/getMe")) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: true,
          result: {
            id: 1234567890,
            is_bot: true,
            username: "lapakgram_e2e_bot",
            first_name: "E2E Bot",
          },
        }),
      );
      return;
    }

    if (url.includes("/setWebhook")) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, description: "Webhook was set" }));
      return;
    }

    // Any other Bot API method: succeed with an empty-ish ok payload.
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolve) => {
    server!.listen(TELEGRAM_MOCK_PORT, "127.0.0.1", resolve);
  });

  // Playwright runs the returned function as global teardown.
  return async () => {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  };
}

export default globalSetup;
