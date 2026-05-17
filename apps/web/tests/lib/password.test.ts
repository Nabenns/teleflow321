import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../lib/auth/password.js";

describe("password", () => {
  it("hashes a password and verifies it back", async () => {
    const plain = "correct horse battery staple";
    const hash = await hashPassword(plain);
    expect(hash).not.toBe(plain);
    expect(hash.length).toBeGreaterThan(50);
    expect(await verifyPassword(plain, hash)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", hash)).toBe(false);
  });

  it("produces different hash for same plaintext (random salt)", async () => {
    const a = await hashPassword("samepass");
    const b = await hashPassword("samepass");
    expect(a).not.toBe(b);
    expect(await verifyPassword("samepass", a)).toBe(true);
    expect(await verifyPassword("samepass", b)).toBe(true);
  });

  it("rejects empty password at hash time", async () => {
    await expect(hashPassword("")).rejects.toThrow(/non-empty/i);
  });

  it("verifyPassword returns false for malformed hash", async () => {
    expect(await verifyPassword("anything", "not-a-bcrypt-hash")).toBe(false);
  });
});
