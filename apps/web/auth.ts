import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { createDb, schema } from "@lapakgram/db";
import { verifyPassword } from "./lib/auth/password.js";
import { verifyTelegramAuth } from "./lib/auth/telegram-oauth.js";
import { authConfig } from "./auth.config.js";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      telegramId: string | null;
    } & DefaultSession["user"];
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required");

const db = createDb(databaseUrl);
const TELEGRAM_LOGIN_BOT_TOKEN = process.env.TELEGRAM_LOGIN_BOT_TOKEN ?? "";

export const {
  handlers: { GET, POST },
  signIn,
  signOut,
  auth,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "credentials",
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (
          typeof credentials?.email !== "string" ||
          typeof credentials?.password !== "string"
        ) {
          return null;
        }
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, credentials.email))
          .limit(1);
        if (!user || !user.passwordHash) return null;
        if (!user.emailVerifiedAt) return null;
        const ok = await verifyPassword(credentials.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.fullName ?? undefined,
          telegramId: user.telegramId?.toString() ?? null,
        };
      },
    }),
    Credentials({
      id: "telegram",
      name: "Telegram",
      credentials: { payload: { label: "Payload", type: "text" } },
      async authorize(input) {
        if (!TELEGRAM_LOGIN_BOT_TOKEN) return null;
        if (typeof input?.payload !== "string") return null;
        let parsed: unknown;
        try {
          parsed = JSON.parse(input.payload);
        } catch {
          return null;
        }
        if (!parsed || typeof parsed !== "object") return null;
        const result = verifyTelegramAuth(
          parsed as Parameters<typeof verifyTelegramAuth>[0],
          TELEGRAM_LOGIN_BOT_TOKEN,
        );
        if (!result.ok) return null;
        const tgUser = result.user;
        // Find or create user by telegram_id.
        const [existing] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.telegramId, tgUser.id))
          .limit(1);
        let userId: string;
        if (existing) {
          userId = existing.id;
        } else {
          const [created] = await db
            .insert(schema.users)
            .values({
              telegramId: tgUser.id,
              telegramUsername: tgUser.username ?? null,
              fullName: [tgUser.firstName, tgUser.lastName].filter(Boolean).join(" ") || null,
              emailVerifiedAt: new Date(), // Telegram identity counts as verified
            })
            .returning();
          if (!created) return null;
          userId = created.id;
        }
        return {
          id: userId,
          email: existing?.email ?? null,
          name: [tgUser.firstName, tgUser.lastName].filter(Boolean).join(" ") || undefined,
          telegramId: tgUser.id.toString(),
        };
      },
    }),
  ],
});
