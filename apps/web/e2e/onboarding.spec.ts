import { expect, test } from "@playwright/test";

// Server-side Telegram calls (getMe/setWebhook in the bot-setup action) are
// mocked by the local server started in e2e/_telegram-mock.ts via
// TELEGRAM_API_BASE_URL. This page.route block additionally short-circuits any
// browser-side call to the real API, keeping the test fully offline.
test.beforeEach(async ({ page }) => {
  await page.route("https://api.telegram.org/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/getMe")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: {
            id: 1234567890,
            is_bot: true,
            username: "lapakgram_e2e_bot",
            first_name: "E2E Bot",
          },
        }),
      });
      return;
    }
    if (url.includes("/setWebhook")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, description: "Webhook was set" }),
      });
      return;
    }
    await route.fulfill({ status: 200, body: "{}" });
  });
});

test("merchant onboarding end-to-end", async ({ page, baseURL }) => {
  const ts = Date.now();
  const ownerEmail = `owner+${ts}@example.com`;
  const ownerPassword = "password123";

  // 1. Register the owner.
  await page.goto("/register");
  await page.fill("input[placeholder='Nama lengkap']", "E2E Owner");
  await page.fill("input[placeholder='Email']", ownerEmail);
  await page.fill("input[placeholder='Password (min 8)']", ownerPassword);
  await page.click("button[type=submit]");
  await expect(page.getByText("Registrasi berhasil")).toBeVisible();

  // 2. Verify email via the dev link surfaced on the register page.
  const devLink = page.getByRole("link", { name: /verify-email\?token=/ });
  await devLink.click();
  await expect(page.getByText("Email diverifikasi")).toBeVisible();

  // 3. Login.
  await page.goto("/login");
  await page.fill("input[placeholder='Email']", ownerEmail);
  await page.fill("input[placeholder='Password']", ownerPassword);
  await page.click("button[type=submit]");
  await page.waitForURL("**/new-merchant");

  // 4. Create the merchant (drives the form; the action derives the owner from
  // the session).
  const slug = `e2e-shop-${ts}`;
  await page.fill("input[placeholder='Nama toko']", "E2E Shop");
  await page.fill("input[placeholder^='slug-toko']", slug);
  await page.click("button[type=submit]");
  await page.waitForURL(`**/${slug}/settings/bot`);

  // 5. Setup the bot (Telegram API mocked server-side + browser-side).
  await page.fill(
    "input[placeholder^='123456']",
    "1234567890:AAH-FAKE-TOKEN-AT-LEAST-30-CHARS",
  );
  await page.click("button[type=submit]");
  await expect(page.getByText("Bot @lapakgram_e2e_bot terhubung")).toBeVisible();
  await page.waitForURL(`**/${slug}`, { timeout: 5000 });

  // 6. Invite a teammate. The invite is addressed to this exact email; the
  // teammate must register with the SAME email to satisfy the identity binding
  // in acceptInvite.
  const teammateEmail = `team+${ts}@example.com`;
  await page.goto(`${baseURL}/${slug}/settings/team`);
  // Scope to the invite form: the page also renders disabled role <select>s in
  // the member table, so target the form's controls explicitly.
  const inviteForm = page.locator("form").filter({ has: page.locator("input[type=email]") });
  await inviteForm.locator("input[type=email]").fill(teammateEmail);
  await inviteForm.locator("select").selectOption("support");
  await inviteForm.locator("button:has-text('Undang')").click();
  // The result hint carries the dev accept URL.
  const inviteHint = page.getByText(/Invite dikirim/);
  await expect(inviteHint).toBeVisible();
  const hintText = await inviteHint.innerText();
  const inviteUrlMatch = hintText.match(/https?:\/\/\S+\/invite\/[^\s]+/);
  expect(inviteUrlMatch).toBeTruthy();
  const inviteUrl = inviteUrlMatch![0]!;

  // 7. New isolated context (incognito-like) for the teammate.
  const teammateContext = await page.context().browser()!.newContext();
  const teammatePage = await teammateContext.newPage();

  // Register the teammate with the SAME email the invite was sent to.
  await teammatePage.goto(`${baseURL}/register`);
  await teammatePage.fill("input[placeholder='Nama lengkap']", "E2E Teammate");
  await teammatePage.fill("input[placeholder='Email']", teammateEmail);
  await teammatePage.fill("input[placeholder='Password (min 8)']", "password123");
  await teammatePage.click("button[type=submit]");
  await expect(teammatePage.getByText("Registrasi berhasil")).toBeVisible();
  const teammateVerifyLink = teammatePage.getByRole("link", {
    name: /verify-email\?token=/,
  });
  await teammateVerifyLink.click();
  await expect(teammatePage.getByText("Email diverifikasi")).toBeVisible();

  // Login as the teammate.
  await teammatePage.goto(`${baseURL}/login`);
  await teammatePage.fill("input[placeholder='Email']", teammateEmail);
  await teammatePage.fill("input[placeholder='Password']", "password123");
  await teammatePage.click("button[type=submit]");
  await teammatePage.waitForURL("**/new-merchant");

  // Accept the invite by visiting the signed URL; identity binding passes
  // because the teammate's email matches the invited email.
  await teammatePage.goto(inviteUrl);
  await teammatePage.waitForURL(`**/${slug}`);

  await teammateContext.close();

  // 8. Owner sees the teammate in the team list.
  await page.reload();
  await expect(page.getByText(teammateEmail)).toBeVisible();
});
