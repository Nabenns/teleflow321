"use server";

import { randomBytes } from "node:crypto";
import { and, count, eq, isNull } from "drizzle-orm";
import { schema } from "@lapakgram/db";
import { getDb } from "../db.js";
import { sendEmail } from "../email/send.js";
import { can, type Permission, type Role } from "../permissions.js";
import {
  createInviteToken,
  hashInviteToken,
  verifyInviteToken,
} from "../auth/invite-token.js";

const INVITE_TTL_HOURS = 168; // 7 days

function getInviteSecret(): string {
  const s = process.env.INVITE_SIGNING_SECRET;
  if (!s) throw new Error("INVITE_SIGNING_SECRET required");
  return s;
}

async function getMembership(
  userId: string,
  merchantId: string,
): Promise<{ role: Role } | null> {
  const db = getDb();
  const [m] = await db
    .select({ role: schema.merchantMembers.role })
    .from(schema.merchantMembers)
    .where(
      and(
        eq(schema.merchantMembers.userId, userId),
        eq(schema.merchantMembers.merchantId, merchantId),
      ),
    )
    .limit(1);
  if (!m) return null;
  return { role: m.role as Role };
}

async function requirePermission(
  userId: string,
  merchantId: string,
  perm: Permission,
): Promise<{ ok: true; role: Role } | { ok: false; reason: string }> {
  const membership = await getMembership(userId, merchantId);
  if (!membership) return { ok: false, reason: "not a member" };
  if (!can(membership.role, perm)) {
    return { ok: false, reason: "permission denied" };
  }
  return { ok: true, role: membership.role };
}

// ============================================================
// invite
// ============================================================
export type InviteResult =
  | { ok: true; inviteId: string; token: string; acceptUrl: string }
  | { ok: false; reason: string };

// Inner business logic + permission check. Tests call this directly with an
// explicit actorUserId because no NextAuth session exists under vitest.
export async function inviteMemberAsActor(input: {
  actorUserId: string;
  merchantId: string;
  email?: string;
  telegramId?: bigint;
  role: Role;
}): Promise<InviteResult> {
  if (!input.email && !input.telegramId) {
    return { ok: false, reason: "email or telegramId required" };
  }
  if (input.role === "owner") {
    return { ok: false, reason: "use ownership transfer flow for owner role" };
  }
  const perm = await requirePermission(
    input.actorUserId,
    input.merchantId,
    "members:invite",
  );
  if (!perm.ok) return perm;

  const db = getDb();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000);

  // Insert with a placeholder hash first so the row (and its id) exists, then
  // sign a JWT carrying the real invite id and update the hash. The token is
  // never stored in plaintext; only its sha256 hash lives in the DB.
  const placeholder = randomBytes(8).toString("hex");
  const placeholderHash = hashInviteToken(placeholder);

  const [invite] = await db
    .insert(schema.merchantInvites)
    .values({
      merchantId: input.merchantId,
      email: input.email ?? null,
      telegramId: input.telegramId ?? null,
      role: input.role,
      tokenHash: placeholderHash,
      invitedBy: input.actorUserId,
      expiresAt,
    })
    .returning({ id: schema.merchantInvites.id });
  if (!invite) return { ok: false, reason: "invite insert failed" };

  const token = await createInviteToken(
    { inviteId: invite.id, merchantId: input.merchantId },
    getInviteSecret(),
    { ttlSeconds: INVITE_TTL_HOURS * 3600 },
  );
  const tokenHash = hashInviteToken(token);
  await db
    .update(schema.merchantInvites)
    .set({ tokenHash })
    .where(eq(schema.merchantInvites.id, invite.id));

  const acceptUrl = `${
    process.env.NEXTAUTH_URL ?? "http://localhost:3000"
  }/invite/${encodeURIComponent(token)}`;

  if (input.email) {
    await sendEmail({
      to: input.email,
      subject: "You've been invited to a Lapakgram team",
      textBody: `Klik link berikut untuk join: ${acceptUrl}\n\nLink berlaku ${INVITE_TTL_HOURS} jam.`,
    });
  }

  return { ok: true, inviteId: invite.id, token, acceptUrl };
}

// Thin server action: derives the actor from the session and ignores any
// client-supplied id. `auth` is imported lazily because the NextAuth module
// opens a DB pool at load time and only runs inside a real request.
export async function inviteMember(input: {
  merchantId: string;
  email?: string;
  telegramId?: bigint;
  role: Role;
}): Promise<InviteResult> {
  const { auth } = await import("../../auth.js");
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthorized" };
  return inviteMemberAsActor({ actorUserId: session.user.id, ...input });
}

// ============================================================
// accept
// ============================================================
export type AcceptResult =
  | { ok: true; merchantId: string; role: Role }
  | { ok: false; reason: string };

// Inner logic. Verifies the signed token, then claims the invite and creates
// the membership in a single transaction. Coarse reasons only — never leak the
// underlying jose/db error string to the caller.
// Sentinel thrown inside the accept transaction to force a rollback with a
// caller-facing reason. postgres-js rolls back when the callback throws.
class AcceptAbort extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export async function acceptInviteAsUser(input: {
  userId: string;
  token: string;
}): Promise<AcceptResult> {
  const verify = await verifyInviteToken(input.token, getInviteSecret());
  if (!verify.ok) return { ok: false, reason: "invalid invite" };
  const tokenHash = hashInviteToken(input.token);

  const db = getDb();
  const [invite] = await db
    .select()
    .from(schema.merchantInvites)
    .where(eq(schema.merchantInvites.tokenHash, tokenHash))
    .limit(1);
  if (!invite) return { ok: false, reason: "invite not found" };
  if (invite.acceptedAt) return { ok: false, reason: "invite already used" };
  if (invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "invite expired" };
  }

  // Identity binding: an invite is addressed to a specific email and/or
  // telegram id. Without this check it is a pure bearer token — anyone who
  // obtains the link could join. Require the accepting user to match every
  // channel the invite was addressed to.
  const [user] = await db
    .select({ email: schema.users.email, telegramId: schema.users.telegramId })
    .from(schema.users)
    .where(eq(schema.users.id, input.userId))
    .limit(1);
  if (!user) return { ok: false, reason: "user not found" };
  if (invite.email) {
    const inviteEmail = invite.email.trim().toLowerCase();
    const userEmail = user.email?.trim().toLowerCase() ?? null;
    if (userEmail !== inviteEmail) {
      return { ok: false, reason: "invite addressed to a different account" };
    }
  }
  if (invite.telegramId !== null && invite.telegramId !== undefined) {
    if (user.telegramId !== invite.telegramId) {
      return { ok: false, reason: "invite addressed to a different account" };
    }
  }

  // Already a member? Report cleanly instead of letting the unique index throw.
  const existingMembership = await getMembership(input.userId, invite.merchantId);
  if (existingMembership) {
    return { ok: false, reason: "already a member" };
  }

  // Add membership and claim the invite atomically. The claim is a conditional
  // UPDATE guarded by `accepted_at IS NULL`; if a concurrent accept already
  // consumed it, RETURNING yields zero rows and we roll back. This closes the
  // TOCTOU between the read above and the write here.
  try {
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(schema.merchantInvites)
        .set({ acceptedAt: new Date(), acceptedByUserId: input.userId })
        .where(
          and(
            eq(schema.merchantInvites.id, invite.id),
            isNull(schema.merchantInvites.acceptedAt),
          ),
        )
        .returning({ id: schema.merchantInvites.id });
      if (claimed.length === 0) {
        throw new AcceptAbort("invite already used");
      }
      await tx.insert(schema.merchantMembers).values({
        merchantId: invite.merchantId,
        userId: input.userId,
        role: invite.role,
        acceptedAt: new Date(),
      });
    });
  } catch (err) {
    if (err instanceof AcceptAbort) {
      return { ok: false, reason: err.reason };
    }
    // A unique-violation here means a concurrent request created the same
    // membership; treat it as already a member rather than a 500.
    return { ok: false, reason: "already a member" };
  }

  return { ok: true, merchantId: invite.merchantId, role: invite.role as Role };
}

// Thin server action: derives the accepting user from the session.
export async function acceptInvite(input: {
  token: string;
}): Promise<AcceptResult> {
  const { auth } = await import("../../auth.js");
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthorized" };
  return acceptInviteAsUser({ userId: session.user.id, token: input.token });
}

// ============================================================
// change role
// ============================================================
export type ChangeRoleResult = { ok: true } | { ok: false; reason: string };

export async function changeMemberRoleAsActor(input: {
  actorUserId: string;
  merchantId: string;
  targetUserId: string;
  newRole: Role;
}): Promise<ChangeRoleResult> {
  if (input.newRole === "owner") {
    return { ok: false, reason: "use ownership transfer flow for owner role" };
  }
  const perm = await requirePermission(
    input.actorUserId,
    input.merchantId,
    "members:change-role",
  );
  if (!perm.ok) return perm;

  const db = getDb();

  // Demoting the sole owner to a non-owner role would leave the merchant
  // ownerless and unmanageable — the same outcome the removal guard prevents,
  // reachable through this path. Block it symmetrically. (newRole is already
  // narrowed to a non-owner role by the guard at the top of this function.)
  const target = await getMembership(input.targetUserId, input.merchantId);
  if (!target) return { ok: false, reason: "not a member" };
  if (target.role === "owner") {
    const [owners] = await db
      .select({ value: count() })
      .from(schema.merchantMembers)
      .where(
        and(
          eq(schema.merchantMembers.merchantId, input.merchantId),
          eq(schema.merchantMembers.role, "owner"),
        ),
      );
    if (!owners || owners.value <= 1) {
      return { ok: false, reason: "cannot demote last owner" };
    }
  }

  await db
    .update(schema.merchantMembers)
    .set({ role: input.newRole })
    .where(
      and(
        eq(schema.merchantMembers.merchantId, input.merchantId),
        eq(schema.merchantMembers.userId, input.targetUserId),
      ),
    );
  return { ok: true };
}

// Thin server action.
export async function changeMemberRole(input: {
  merchantId: string;
  targetUserId: string;
  newRole: Role;
}): Promise<ChangeRoleResult> {
  const { auth } = await import("../../auth.js");
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthorized" };
  return changeMemberRoleAsActor({ actorUserId: session.user.id, ...input });
}

// ============================================================
// remove
// ============================================================
export type RemoveResult = { ok: true } | { ok: false; reason: string };

export async function removeMemberAsActor(input: {
  actorUserId: string;
  merchantId: string;
  targetUserId: string;
}): Promise<RemoveResult> {
  const perm = await requirePermission(
    input.actorUserId,
    input.merchantId,
    "members:remove",
  );
  if (!perm.ok) return perm;

  const db = getDb();

  // Never strip a merchant of its last owner, or it becomes unmanageable.
  const target = await getMembership(input.targetUserId, input.merchantId);
  if (target?.role === "owner") {
    const [owners] = await db
      .select({ value: count() })
      .from(schema.merchantMembers)
      .where(
        and(
          eq(schema.merchantMembers.merchantId, input.merchantId),
          eq(schema.merchantMembers.role, "owner"),
        ),
      );
    if (!owners || owners.value <= 1) {
      return { ok: false, reason: "cannot remove last owner" };
    }
  }

  await db
    .delete(schema.merchantMembers)
    .where(
      and(
        eq(schema.merchantMembers.merchantId, input.merchantId),
        eq(schema.merchantMembers.userId, input.targetUserId),
      ),
    );
  return { ok: true };
}

// Thin server action.
export async function removeMember(input: {
  merchantId: string;
  targetUserId: string;
}): Promise<RemoveResult> {
  const { auth } = await import("../../auth.js");
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthorized" };
  return removeMemberAsActor({ actorUserId: session.user.id, ...input });
}

// ============================================================
// list
// ============================================================
export interface MemberRow {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  acceptedAt: Date | null;
}

export type ListMembersResult =
  | { ok: true; members: MemberRow[] }
  | { ok: false; reason: string };

export async function listMembersAsActor(input: {
  actorUserId: string;
  merchantId: string;
}): Promise<ListMembersResult> {
  // Anyone in the merchant can see the team list.
  const m = await getMembership(input.actorUserId, input.merchantId);
  if (!m) return { ok: false, reason: "not a member" };

  const db = getDb();
  const rows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      fullName: schema.users.fullName,
      role: schema.merchantMembers.role,
      acceptedAt: schema.merchantMembers.acceptedAt,
    })
    .from(schema.merchantMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.merchantMembers.userId))
    .where(eq(schema.merchantMembers.merchantId, input.merchantId));

  return {
    ok: true,
    members: rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      fullName: r.fullName,
      role: r.role as Role,
      acceptedAt: r.acceptedAt,
    })),
  };
}

// Thin server action.
export async function listMembers(input: {
  merchantId: string;
}): Promise<ListMembersResult> {
  const { auth } = await import("../../auth.js");
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthorized" };
  return listMembersAsActor({ actorUserId: session.user.id, merchantId: input.merchantId });
}
