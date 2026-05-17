import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramAuth } from "../../lib/auth/telegram-oauth.js";

const BOT_TOKEN = "1234567890:AAH-FAKE-TOKEN";

function signAuth(payload: Record<string, string | number>): string {
  const lines = Object.entries(payload)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  return createHmac("sha256", secretKey).update(lines).digest("hex");
}

describe("verifyTelegramAuth", () => {
  it("accepts a valid payload", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: 12345,
      first_name: "Alice",
      auth_date: now,
    };
    const hash = signAuth(payload);
    const result = verifyTelegramAuth({ ...payload, hash }, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(12345n);
  });

  it("rejects tampered payload (wrong hash)", () => {
    const payload = {
      id: 12345,
      first_name: "Alice",
      auth_date: Math.floor(Date.now() / 1000),
      hash: "0".repeat(64),
    };
    const result = verifyTelegramAuth(payload, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it("rejects payload signed with different bot token", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { id: 12345, first_name: "Alice", auth_date: now };
    const hash = signAuth(payload);
    const result = verifyTelegramAuth({ ...payload, hash }, "999:DIFFERENT");
    expect(result.ok).toBe(false);
  });

  it("rejects stale auth_date (>24h old)", () => {
    const old = Math.floor(Date.now() / 1000) - 25 * 3600;
    const payload = { id: 1, first_name: "A", auth_date: old };
    const hash = signAuth(payload);
    const result = verifyTelegramAuth({ ...payload, hash }, BOT_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale|expired/i);
  });

  it("returns parsed user fields including username when present", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: 99,
      first_name: "Bob",
      last_name: "Smith",
      username: "bobby",
      auth_date: now,
    };
    const hash = signAuth(payload);
    const result = verifyTelegramAuth({ ...payload, hash }, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(99n);
      expect(result.user.firstName).toBe("Bob");
      expect(result.user.lastName).toBe("Smith");
      expect(result.user.username).toBe("bobby");
    }
  });
});
