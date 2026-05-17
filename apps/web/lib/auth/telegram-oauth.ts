import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramAuthPayload {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
  [key: string]: unknown;
}

export interface TelegramUser {
  id: bigint;
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export type VerifyResult =
  | { ok: true; user: TelegramUser }
  | { ok: false; reason: string };

const MAX_AGE_SECONDS = 24 * 60 * 60;
const HEX_64_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Verify a Telegram Login Widget payload.
 *
 * Per https://core.telegram.org/widgets/login#checking-authorization, the
 * widget posts a payload signed with HMAC-SHA-256. The HMAC key is
 * SHA256(bot_token) — note: NOT HMAC(bot_token, ...). The data-check string
 * is built from all payload fields except `hash`, sorted by key, joined as
 * `key=value` lines with `\n` separators.
 *
 * Returns ok=true with parsed user fields, or ok=false with a reason. Reasons
 * are stable strings and may be matched in tests.
 *
 * Note: a captured valid payload is replayable within the freshness window
 * (24h). Login flows tolerate this because the attacker still needs a path
 * to the user's session/cookies.
 */
export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string,
): VerifyResult {
  if (!botToken) {
    return { ok: false, reason: "empty bot token" };
  }
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "missing payload" };
  }
  if (typeof payload.hash !== "string" || !HEX_64_REGEX.test(payload.hash)) {
    return { ok: false, reason: "missing or malformed hash" };
  }

  // Build data-check string: all fields except `hash`, sorted, joined by \n.
  const lines = Object.entries(payload)
    .filter(([k]) => k !== "hash")
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(lines).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(payload.hash, "hex");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "hash mismatch" };
  }

  const authDate =
    typeof payload.auth_date === "number"
      ? payload.auth_date
      : parseInt(payload.auth_date, 10);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "missing auth_date" };
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS) {
    return { ok: false, reason: "auth_date stale (expired)" };
  }
  if (ageSeconds < -60) {
    return { ok: false, reason: "auth_date in future" };
  }

  const idVal = typeof payload.id === "number" ? payload.id : parseInt(String(payload.id), 10);
  if (!Number.isFinite(idVal)) {
    return { ok: false, reason: "missing id" };
  }

  return {
    ok: true,
    user: {
      id: BigInt(idVal),
      firstName: typeof payload.first_name === "string" ? payload.first_name : undefined,
      lastName: typeof payload.last_name === "string" ? payload.last_name : undefined,
      username: typeof payload.username === "string" ? payload.username : undefined,
      photoUrl: typeof payload.photo_url === "string" ? payload.photo_url : undefined,
    },
  };
}
