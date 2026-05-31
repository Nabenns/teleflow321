import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser, consumeEmailVerification } from "../../lib/server-actions/auth.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://lapakgram:lapakgram_dev@localhost:5434/lapakgram_test_authactions";

// These tests run against a dedicated test database created in the test setup.
// We rely on a small bootstrap helper to create + migrate it. If you use
// testcontainers in this file too, swap the bootstrap accordingly.

describe("auth server actions", () => {
  beforeEach(() => {
    // Setup helper (tests/_helpers/setup.ts) creates lapakgram_test_web and
    // sets process.env.TEST_DATABASE_URL in beforeAll. We read that fresh
    // here because the const above captures process.env at module-load time,
    // which runs before beforeAll fires.
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("registerUser creates a user and an email verification token", async () => {
    const result = await registerUser({
      email: `user+${Date.now()}@example.com`,
      password: "password123",
      fullName: "Test User",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.devVerifyUrl).toContain("/verify-email?token=");
    }
  });

  it("rejects duplicate email", async () => {
    const email = `dup+${Date.now()}@example.com`;
    const a = await registerUser({ email, password: "password123" });
    expect(a.ok).toBe(true);
    const b = await registerUser({ email, password: "password123" });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toMatch(/already/i);
  });

  it("consumeEmailVerification marks user verified once and rejects re-use", async () => {
    const reg = await registerUser({
      email: `verify+${Date.now()}@example.com`,
      password: "password123",
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const tokenMatch = reg.devVerifyUrl.match(/token=([^&]+)/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1]!;
    const consume1 = await consumeEmailVerification(token);
    expect(consume1.ok).toBe(true);
    const consume2 = await consumeEmailVerification(token);
    expect(consume2.ok).toBe(false);
  });

  it("rejects invalid token", async () => {
    const result = await consumeEmailVerification("not-a-real-token");
    expect(result.ok).toBe(false);
  });
});
