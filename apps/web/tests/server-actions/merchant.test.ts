import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMerchantForUser, listMerchantsForUser } from "../../lib/server-actions/merchant.js";
import { registerUser, consumeEmailVerification } from "../../lib/server-actions/auth.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://lapakgram:lapakgram_dev@localhost:5434/lapakgram_test_web";

async function freshUser() {
  const reg = await registerUser({
    email: `merch+${Date.now()}+${Math.random()}@example.com`,
    password: "password123",
    fullName: "Merchant Owner",
  });
  if (!reg.ok) throw new Error(reg.reason);
  const tokenMatch = reg.devVerifyUrl.match(/token=([^&]+)/);
  if (!tokenMatch) throw new Error("missing verify token");
  await consumeEmailVerification(tokenMatch[1]!);
  return reg.userId;
}

describe("merchant server actions", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("createMerchant inserts merchant + ownership + trial subscription", async () => {
    const userId = await freshUser();
    const slug = `shop-${Date.now()}`;
    const result = await createMerchantForUser({ userId, name: "Shop One", slug });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merchantId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.slug).toBe(slug);
    }
  });

  it("rejects duplicate slug", async () => {
    const userId = await freshUser();
    const slug = `dupslug-${Date.now()}`;
    const a = await createMerchantForUser({ userId, name: "A", slug });
    expect(a.ok).toBe(true);
    const b = await createMerchantForUser({ userId, name: "B", slug });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toMatch(/slug/i);
  });

  it("rejects invalid slug (too short, special chars)", async () => {
    const userId = await freshUser();
    const tooShort = await createMerchantForUser({ userId, name: "X", slug: "ab" });
    expect(tooShort.ok).toBe(false);
    const special = await createMerchantForUser({
      userId,
      name: "X",
      slug: "Has Spaces",
    });
    expect(special.ok).toBe(false);
  });

  it("listMerchantsForUser returns owned merchants with role=owner", async () => {
    const userId = await freshUser();
    const slug = `list-${Date.now()}`;
    await createMerchantForUser({ userId, name: "Listed", slug });
    const list = await listMerchantsForUser(userId);
    expect(list.length).toBeGreaterThan(0);
    const found = list.find((m) => m.slug === slug);
    expect(found).toBeDefined();
    expect(found?.role).toBe("owner");
  });
});
