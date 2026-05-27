"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";
import { hashPassword } from "../auth/password.js";
import { sendEmail } from "../email/send.js";

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  return createDb(url);
}

const VERIFY_TTL_HOURS = 24;

export type RegisterResult =
  | { ok: true; userId: string; devVerifyUrl: string }
  | { ok: false; reason: string };

export async function registerUser(input: {
  email: string;
  password: string;
  fullName?: string;
}): Promise<RegisterResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "invalid email" };
  }
  if (input.password.length < 8) {
    return { ok: false, reason: "password must be at least 8 chars" };
  }
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) return { ok: false, reason: "email already registered" };

  const passwordHash = await hashPassword(input.password);

  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      fullName: input.fullName ?? null,
    })
    .returning({ id: schema.users.id });
  if (!user) return { ok: false, reason: "insert failed" };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 3600 * 1000);
  await db.insert(schema.emailVerifications).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const verifyUrl = `${
    process.env.NEXTAUTH_URL ?? "http://localhost:3000"
  }/verify-email?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Verify your Lapakgram email",
    textBody: `Halo, klik link berikut untuk verifikasi: ${verifyUrl}\n\nLink berlaku ${VERIFY_TTL_HOURS} jam.`,
  });

  return { ok: true, userId: user.id, devVerifyUrl: verifyUrl };
}

export type ConsumeResult = { ok: true; userId: string } | { ok: false; reason: string };

export async function consumeEmailVerification(token: string): Promise<ConsumeResult> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = getDb();

  const [row] = await db
    .select()
    .from(schema.emailVerifications)
    .where(
      and(
        eq(schema.emailVerifications.tokenHash, tokenHash),
        isNull(schema.emailVerifications.consumedAt),
        gt(schema.emailVerifications.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, reason: "invalid or expired token" };

  await db.transaction(async (tx) => {
    await tx
      .update(schema.emailVerifications)
      .set({ consumedAt: new Date() })
      .where(eq(schema.emailVerifications.id, row.id));
    await tx
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, row.userId));
  });

  return { ok: true, userId: row.userId };
}
