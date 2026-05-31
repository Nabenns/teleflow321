import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { schema } from "@lapakgram/db";
import { getDb } from "@/lib/db";
import { decryptSecret, parseKeyFromBase64 } from "@/lib/crypto";

export const runtime = "nodejs";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string; first_name?: string };
  };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ secret: string }> },
): Promise<NextResponse> {
  const { secret } = await ctx.params;

  const db = getDb();
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.webhookSecret, secret))
    .limit(1);
  if (!merchant) {
    return NextResponse.json({ ok: false, error: "unknown webhook" }, { status: 404 });
  }

  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!headerSecret || headerSecret !== merchant.webhookTelegramSecret) {
    return NextResponse.json({ ok: false, error: "bad secret token" }, { status: 401 });
  }

  if (!merchant.botTokenEncrypted) {
    return NextResponse.json({ ok: true, note: "merchant has no token (stub)" });
  }

  const update = (await req.json()) as TelegramUpdate;
  const text = update.message?.text;
  const chatId = update.message?.chat.id;

  // Decrypt token to call sendMessage. (Plan 3 moves this to Go bot service.)
  const masterKey = parseKeyFromBase64(process.env.MASTER_ENCRYPTION_KEY!);
  const token = decryptSecret(merchant.botTokenEncrypted as unknown as Buffer, masterKey);

  if (text === "/start" && chatId) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Halo! Toko ${merchant.name} sedang disiapkan. Fitur belanja akan aktif segera.`,
      }),
    });
  }

  // Respond fast; Telegram retries if we take >2s.
  return NextResponse.json({ ok: true });
}
