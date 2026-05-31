"use server";

import { randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { schema } from "@lapakgram/db";
import { getDb } from "../db.js";
import { encryptSecret, parseKeyFromBase64 } from "../crypto.js";
import { can, type Role } from "../permissions.js";
import { getMe, setWebhook } from "../telegram/client.js";

export type SetupBotResult =
  | { ok: true; botUsername: string; botId: string }
  | { ok: false; reason: string };

// Server action: authorizes the caller via session before touching any
// merchant's bot config. A Next.js server action is an independently-invokable
// POST endpoint, so trusting the caller-supplied merchantId alone would let
// anyone overwrite any merchant's bot token. We verify the session user is a
// member of that merchant and holds a role that can configure the bot, then
// delegate the business logic to setupBotForMerchantUnchecked.
//
// `auth` is imported lazily: the NextAuth module (apps/web/auth.ts) opens a DB
// pool at module-load time and only runs inside a real request, so a static
// import would pull request-time machinery into every importer (including the
// vitest suite, which exercises setupBotForMerchantUnchecked directly without
// a session).
export async function setupBotForMerchant(input: {
  merchantId: string;
  botToken: string;
}): Promise<SetupBotResult> {
  const { auth } = await import("../../auth.js");
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, reason: "unauthorized" };
  }

  const db = getDb();
  const [member] = await db
    .select({ role: schema.merchantMembers.role })
    .from(schema.merchantMembers)
    .where(
      and(
        eq(schema.merchantMembers.merchantId, input.merchantId),
        eq(schema.merchantMembers.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) {
    return { ok: false, reason: "not a member of this merchant" };
  }

  // The bot-config permission isn't in the matrix yet; gate on products:write,
  // which only owner + admin hold. This keeps bot setup to roles that already
  // manage the storefront, and avoids letting finance/support reconfigure it.
  if (!can(member.role as Role, "products:write")) {
    return { ok: false, reason: "insufficient permissions" };
  }

  return setupBotForMerchantUnchecked({
    merchantId: input.merchantId,
    botToken: input.botToken,
  });
}

// Inner business logic. Kept separate (and exported) so tests can exercise it
// directly without a NextAuth session. Performs no authorization — callers must
// have already verified the caller may configure this merchant's bot.
export async function setupBotForMerchantUnchecked(input: {
  merchantId: string;
  botToken: string;
}): Promise<SetupBotResult> {
  const tokenTrim = input.botToken.trim();
  // BotFather tokens are `<digits>:<35-ish base64url chars>`. Require at
  // least 30 chars after the colon to reject obviously malformed input
  // before spending a network round-trip on getMe.
  if (!/^[0-9]+:[A-Za-z0-9_-]{30,}$/.test(tokenTrim)) {
    return { ok: false, reason: "token format invalid" };
  }
  const masterKeyB64 = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKeyB64) return { ok: false, reason: "MASTER_ENCRYPTION_KEY not set" };
  const masterKey = parseKeyFromBase64(masterKeyB64);

  // 1. Validate via getMe
  const me = await getMe(tokenTrim);
  if (!me.ok || !me.result) {
    return { ok: false, reason: me.description ?? "getMe failed" };
  }
  if (!me.result.is_bot) {
    return { ok: false, reason: "token does not represent a bot" };
  }
  const botId = me.result.id;
  const botUsername = me.result.username;

  // 2. Generate webhook secrets
  const webhookSecret = randomBytes(24).toString("base64url");
  const webhookTelegramSecret = randomBytes(32).toString("base64url");
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const webhookUrl = `${baseUrl}/api/webhooks/telegram/${webhookSecret}`;

  // 3. Persist token + secrets (status still pending_setup until webhook confirmed)
  const encrypted = encryptSecret(tokenTrim, masterKey);
  const db = getDb();
  await db
    .update(schema.merchants)
    .set({
      botTokenEncrypted: encrypted,
      botTokenKeyVersion: 1,
      botUsername,
      botId: BigInt(botId),
      webhookSecret,
      webhookTelegramSecret,
    })
    .where(eq(schema.merchants.id, input.merchantId));

  // 4. Call Telegram setWebhook
  const wh = await setWebhook(tokenTrim, {
    url: webhookUrl,
    secretToken: webhookTelegramSecret,
    dropPendingUpdates: true,
  });
  if (!wh.ok) {
    // Roll back token storage so the user can retry cleanly.
    await db
      .update(schema.merchants)
      .set({
        botTokenEncrypted: null,
        botUsername: null,
        botId: null,
        webhookSecret: null,
        webhookTelegramSecret: null,
      })
      .where(eq(schema.merchants.id, input.merchantId));
    return { ok: false, reason: wh.description ?? "setWebhook failed" };
  }

  // 5. Mark merchant active
  await db
    .update(schema.merchants)
    .set({ status: "active" })
    .where(eq(schema.merchants.id, input.merchantId));

  return { ok: true, botUsername, botId: String(botId) };
}
