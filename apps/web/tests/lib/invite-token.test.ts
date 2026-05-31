import { describe, expect, it } from "vitest";
import {
  createInviteToken,
  hashInviteToken,
  verifyInviteToken,
} from "../../lib/auth/invite-token.js";

const SIGNING_SECRET = Buffer.alloc(32, 7).toString("base64");

describe("invite token", () => {
  it("issues and verifies a token round-trip", async () => {
    const token = await createInviteToken(
      {
        inviteId: "11111111-1111-1111-1111-111111111111",
        merchantId: "22222222-2222-2222-2222-222222222222",
      },
      SIGNING_SECRET,
      { ttlSeconds: 3600 },
    );
    const result = await verifyInviteToken(token, SIGNING_SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.inviteId).toBe("11111111-1111-1111-1111-111111111111");
      expect(result.payload.merchantId).toBe("22222222-2222-2222-2222-222222222222");
    }
  });

  it("rejects expired token", async () => {
    const token = await createInviteToken({ inviteId: "abc", merchantId: "xyz" }, SIGNING_SECRET, {
      ttlSeconds: -10,
    });
    const result = await verifyInviteToken(token, SIGNING_SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects token signed with different secret", async () => {
    const token = await createInviteToken({ inviteId: "abc", merchantId: "xyz" }, SIGNING_SECRET, {
      ttlSeconds: 3600,
    });
    const otherSecret = Buffer.alloc(32, 9).toString("base64");
    const result = await verifyInviteToken(token, otherSecret);
    expect(result.ok).toBe(false);
  });

  it("rejects malformed token", async () => {
    const result = await verifyInviteToken("not.a.jwt", SIGNING_SECRET);
    expect(result.ok).toBe(false);
  });

  it("hashInviteToken is deterministic and 64 hex chars", () => {
    const a = hashInviteToken("some-token");
    const b = hashInviteToken("some-token");
    const c = hashInviteToken("other-token");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
