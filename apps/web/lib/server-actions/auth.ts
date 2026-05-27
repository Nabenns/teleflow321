"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createDb, schema, type LapakgramDb } from "@lapakgram/db";
import { hashPassword } from "../auth/password.js";
import { sendEmail } from "../email/send.js";

// Memoized per-URL DB pool. Server actions are invoked many times per
// process; without this, each call spawns a fresh postgres-js pool.
let cached: { url: string; db: LapakgramDb } | null = null;
function getDb(): LapakgramDb {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  if (cached?.url === url) return cached.db;
  cached = { url, db: createDb(url) };
  return cached.db;
}

const VERIFY_TTL_HOURS = 24;
const isProd = process.env.NODE_ENV === "production";

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
  const passwordHash = await hashPassword(input.password);

  // Atomic insert with ON CONFLICT DO NOTHING. Two concurrent registrations
  // with the same email both pass the same INSERT but only one row appears;
  // the loser sees an empty .returning() and is told the email is taken.
  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      fullName: input.fullName ?? null,
    })
    .onConflictDoNothing({ target: schema.users.email })
    .returning({ id: schema.users.id });
  if (!user) return { ok: false, reason: "email already registered" };

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

  // Production must not leak the verification token in the HTTP response.
  // Dev/test surfaces it so the registration flow is testable without a
  // real email provider.
  return {
    ok: true,
    userId: user.id,
    devVerifyUrl: isProd ? "" : verifyUrl,
  };
}

export type ConsumeResult = { ok: true; userId: string } | { ok: false; reason: string };

export async function consumeEmailVerification(token: string): Promise<ConsumeResult> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = getDb();

  // Atomic claim of the verification token: stamp consumedAt only if it is
  // currently null and not expired. Using RETURNING gives us the userId in
  // the same round-trip and prevents two concurrent calls from both
  // succeeding on the same token.
  const [claimed] = await db
    .update(schema.emailVerifications)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(schema.emailVerifications.tokenHash, tokenHash),
        isNull(schema.emailVerifications.consumedAt),
        gt(schema.emailVerifications.expiresAt, new Date()),
      ),
    )
    .returning({ userId: schema.emailVerifications.userId });
  if (!claimed) return { ok: false, reason: "invalid or expired token" };

  await db
    .update(schema.users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(schema.users.id, claimed.userId));

  return { ok: true, userId: claimed.userId };
}
