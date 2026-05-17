import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export interface InvitePayload {
  inviteId: string;
  merchantId: string;
}

export type VerifyInviteResult =
  | { ok: true; payload: InvitePayload }
  | { ok: false; reason: string };

function getKey(secret: string): Uint8Array {
  const buf = Buffer.from(secret, "base64");
  if (buf.length < 32) {
    throw new Error("invite signing secret must be at least 32 bytes (base64-encoded)");
  }
  return buf;
}

export async function createInviteToken(
  payload: InvitePayload,
  secret: string,
  options: { ttlSeconds: number },
): Promise<string> {
  const key = getKey(secret);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ inviteId: payload.inviteId, merchantId: payload.merchantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + options.ttlSeconds)
    .setIssuer("lapakgram")
    .setAudience("lapakgram-invite")
    .sign(key);
}

export async function verifyInviteToken(
  token: string,
  secret: string,
): Promise<VerifyInviteResult> {
  try {
    const key = getKey(secret);
    const { payload } = await jwtVerify(token, key, {
      issuer: "lapakgram",
      audience: "lapakgram-invite",
    });
    if (
      typeof payload.inviteId !== "string" ||
      typeof payload.merchantId !== "string"
    ) {
      return { ok: false, reason: "missing claims" };
    }
    return { ok: true, payload: { inviteId: payload.inviteId, merchantId: payload.merchantId } };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "verify failed" };
  }
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
