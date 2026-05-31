import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";
import { decryptSecret, parseKeyFromBase64 } from "../../lib/crypto.js";
import { setupBotForMerchantUnchecked } from "../../lib/server-actions/bot.js";
import { createMerchantForUser } from "../../lib/server-actions/merchant.js";
import { registerUser, consumeEmailVerification } from "../../lib/server-actions/auth.js";

async function freshOwnerAndMerchant() {
  const reg = await registerUser({
    email: `bot+${Date.now()}+${Math.random()}@example.com`,
    password: "password123",
  });
  if (!reg.ok) throw new Error(reg.reason);
  await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);
  const m = await createMerchantForUser({
    userId: reg.userId,
    name: "Bot Test",
    slug: `bot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  if (!m.ok) throw new Error(m.reason);
  return { userId: reg.userId, merchantId: m.merchantId };
}

const FAKE_KEY = Buffer.alloc(32, 5).toString("base64");

describe("bot server actions", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("validates token via getMe, encrypts and stores it, sets webhook", async () => {
    const { merchantId } = await freshOwnerAndMerchant();
    process.env.MASTER_ENCRYPTION_KEY = FAKE_KEY;
    process.env.NEXTAUTH_URL = "http://localhost:3000";

    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/getMe")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { id: 1234567890, is_bot: true, username: "lapakgram_test_bot", first_name: "Test" },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/setWebhook")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 500 });
    });

    const result = await setupBotForMerchantUnchecked({
      merchantId,
      botToken: "1234567890:AAH-FAKE-TOKEN-AT-LEAST-30-CHARS-XYZ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.botUsername).toBe("lapakgram_test_bot");
      expect(result.botId).toBe("1234567890");
    }

    const db = createDb(process.env.DATABASE_URL!);
    const [m] = await db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.id, merchantId))
      .limit(1);
    expect(m?.status).toBe("active");
    expect(m?.botUsername).toBe("lapakgram_test_bot");
    expect(m?.webhookSecret).toBeTruthy();
    expect(m?.webhookTelegramSecret).toBeTruthy();
    expect(m?.botTokenEncrypted).toBeTruthy();

    // Decrypt and verify roundtrip
    const key = parseKeyFromBase64(FAKE_KEY);
    const blob = m?.botTokenEncrypted as unknown as Buffer;
    expect(decryptSecret(blob, key)).toBe("1234567890:AAH-FAKE-TOKEN-AT-LEAST-30-CHARS-XYZ");

    // Verify setWebhook was called with our URL pattern
    const setWebhookCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/setWebhook"),
    );
    expect(setWebhookCall).toBeTruthy();
  });

  it("rejects token when Telegram getMe returns ok=false", async () => {
    const { merchantId } = await freshOwnerAndMerchant();
    process.env.MASTER_ENCRYPTION_KEY = FAKE_KEY;
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }),
    );
    const result = await setupBotForMerchantUnchecked({
      merchantId,
      botToken: "bogus",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unauthorized|invalid/i);
  });

  it("rolls back DB if setWebhook fails", async () => {
    const { merchantId } = await freshOwnerAndMerchant();
    process.env.MASTER_ENCRYPTION_KEY = FAKE_KEY;
    process.env.NEXTAUTH_URL = "http://localhost:3000";

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/getMe")) {
        return new Response(
          JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: "u", first_name: "f" } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: false, description: "Bad webhook" }), { status: 200 });
    });

    const result = await setupBotForMerchantUnchecked({ merchantId, botToken: "12:TOKEN-LONG-ENOUGH-TO-PASS-FORMAT-CHECK" });
    expect(result.ok).toBe(false);

    const db = createDb(process.env.DATABASE_URL!);
    const [m] = await db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.id, merchantId))
      .limit(1);
    expect(m?.status).toBe("pending_setup");
    expect(m?.botTokenEncrypted).toBeNull();
  });
});
