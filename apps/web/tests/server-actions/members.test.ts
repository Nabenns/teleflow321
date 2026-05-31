import { beforeEach, describe, expect, it } from "vitest";
import {
  inviteMemberAsActor,
  acceptInviteAsUser,
  changeMemberRoleAsActor,
  removeMemberAsActor,
  listMembersAsActor,
} from "../../lib/server-actions/members.js";
import { createMerchantForUser } from "../../lib/server-actions/merchant.js";
import { registerUser, consumeEmailVerification } from "../../lib/server-actions/auth.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://lapakgram:lapakgram_dev@localhost:5434/lapakgram_test_web";

async function freshUserMerchant() {
  const reg = await registerUser({
    email: `m+${Date.now()}+${Math.random()}@example.com`,
    password: "password123",
    fullName: "Owner",
  });
  if (!reg.ok) throw new Error(reg.reason);
  await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);
  const m = await createMerchantForUser({
    userId: reg.userId,
    name: "Inv Test",
    slug: `inv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  });
  if (!m.ok) throw new Error(m.reason);
  return { ownerId: reg.userId, merchantId: m.merchantId };
}

describe("members", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL;
  });

  it("owner can invite a teammate by email and the invitee can accept", async () => {
    process.env.INVITE_SIGNING_SECRET = Buffer.alloc(32, 1).toString("base64");
    const { ownerId, merchantId } = await freshUserMerchant();
    const inviteeEmail = `invitee+${Date.now()}@example.com`;

    const inv = await inviteMemberAsActor({
      actorUserId: ownerId,
      merchantId,
      email: inviteeEmail,
      role: "support",
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    // Register the invitee
    const reg = await registerUser({ email: inviteeEmail, password: "password123" });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);

    // Accept the invite
    const accept = await acceptInviteAsUser({ userId: reg.userId, token: inv.token });
    expect(accept.ok).toBe(true);
    if (accept.ok) expect(accept.merchantId).toBe(merchantId);

    // Member is listed with the invited role
    const list = await listMembersAsActor({ actorUserId: ownerId, merchantId });
    expect(list.ok).toBe(true);
    if (list.ok) {
      const m = list.members.find((x) => x.userId === reg.userId);
      expect(m?.role).toBe("support");
    }
  });

  it("non-owner without members:invite cannot invite", async () => {
    process.env.INVITE_SIGNING_SECRET = Buffer.alloc(32, 1).toString("base64");
    const { ownerId, merchantId } = await freshUserMerchant();

    // Create a finance member (cannot invite)
    const financeReg = await registerUser({
      email: `fin+${Date.now()}@example.com`,
      password: "password123",
    });
    if (!financeReg.ok) return;
    await consumeEmailVerification(financeReg.devVerifyUrl.match(/token=([^&]+)/)![1]!);
    const inv1 = await inviteMemberAsActor({
      actorUserId: ownerId,
      merchantId,
      email: `fin+${Date.now()}@example.com`,
      role: "finance",
    });
    if (inv1.ok) await acceptInviteAsUser({ userId: financeReg.userId, token: inv1.token });

    const tryInvite = await inviteMemberAsActor({
      actorUserId: financeReg.userId,
      merchantId,
      email: `nope+${Date.now()}@example.com`,
      role: "support",
    });
    expect(tryInvite.ok).toBe(false);
  });

  it("owner can change role and remove members", async () => {
    process.env.INVITE_SIGNING_SECRET = Buffer.alloc(32, 1).toString("base64");
    const { ownerId, merchantId } = await freshUserMerchant();
    const inviteeEmail = `change+${Date.now()}@example.com`;
    const inv = await inviteMemberAsActor({
      actorUserId: ownerId,
      merchantId,
      email: inviteeEmail,
      role: "support",
    });
    if (!inv.ok) return;
    const reg = await registerUser({ email: inviteeEmail, password: "password123" });
    if (!reg.ok) return;
    await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);
    await acceptInviteAsUser({ userId: reg.userId, token: inv.token });

    const changed = await changeMemberRoleAsActor({
      actorUserId: ownerId,
      merchantId,
      targetUserId: reg.userId,
      newRole: "admin",
    });
    expect(changed.ok).toBe(true);

    const removed = await removeMemberAsActor({
      actorUserId: ownerId,
      merchantId,
      targetUserId: reg.userId,
    });
    expect(removed.ok).toBe(true);
  });

  it("cannot remove last owner", async () => {
    const { ownerId, merchantId } = await freshUserMerchant();
    const result = await removeMemberAsActor({
      actorUserId: ownerId,
      merchantId,
      targetUserId: ownerId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/last owner|cannot remove/i);
  });

  it("cannot demote the last owner via change-role", async () => {
    const { ownerId, merchantId } = await freshUserMerchant();
    // The owner is the only owner; demoting to support would orphan the merchant.
    const result = await changeMemberRoleAsActor({
      actorUserId: ownerId,
      merchantId,
      targetUserId: ownerId,
      newRole: "support",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/last owner|demote/i);
  });

  it("rejects accept when the session user does not match the invited email", async () => {
    process.env.INVITE_SIGNING_SECRET = Buffer.alloc(32, 1).toString("base64");
    const { ownerId, merchantId } = await freshUserMerchant();
    const invitedEmail = `wanted+${Date.now()}@example.com`;
    const inv = await inviteMemberAsActor({
      actorUserId: ownerId,
      merchantId,
      email: invitedEmail,
      role: "support",
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    // A DIFFERENT user (different email) tries to accept the bearer link.
    const intruder = await registerUser({
      email: `intruder+${Date.now()}@example.com`,
      password: "password123",
    });
    expect(intruder.ok).toBe(true);
    if (!intruder.ok) return;
    await consumeEmailVerification(intruder.devVerifyUrl.match(/token=([^&]+)/)![1]!);

    const accept = await acceptInviteAsUser({ userId: intruder.userId, token: inv.token });
    expect(accept.ok).toBe(false);
    if (!accept.ok) expect(accept.reason).toMatch(/different account/i);
  });

  it("rejects a second accept of the same invite", async () => {
    process.env.INVITE_SIGNING_SECRET = Buffer.alloc(32, 1).toString("base64");
    const { ownerId, merchantId } = await freshUserMerchant();
    const inviteeEmail = `double+${Date.now()}@example.com`;
    const inv = await inviteMemberAsActor({
      actorUserId: ownerId,
      merchantId,
      email: inviteeEmail,
      role: "support",
    });
    if (!inv.ok) return;
    const reg = await registerUser({ email: inviteeEmail, password: "password123" });
    if (!reg.ok) return;
    await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);

    const first = await acceptInviteAsUser({ userId: reg.userId, token: inv.token });
    expect(first.ok).toBe(true);
    const second = await acceptInviteAsUser({ userId: reg.userId, token: inv.token });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/already used|already a member/i);
  });
});
