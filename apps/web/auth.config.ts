import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe config. Loaded by middleware. Provider list goes in `auth.ts`
 * because some providers (Credentials with bcrypt) require Node runtime.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const path = request.nextUrl.pathname;
      const isAuthPage =
        path.startsWith("/login") ||
        path.startsWith("/register") ||
        path.startsWith("/verify-email") ||
        path.startsWith("/invite/");

      // Public marketing root for now.
      if (path === "/") return true;
      if (isAuthPage) return true;

      // Everything under (dashboard) and (admin) requires auth.
      return isLoggedIn;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.email = user.email ?? null;
        token.telegramId = (user as { telegramId?: string }).telegramId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId as string;
      (session.user as { email?: string | null }).email =
        (token.email as string | null) ?? null;
      (session.user as { telegramId?: string | null }).telegramId =
        (token.telegramId as string | null) ?? null;
      return session;
    },
  },
  session: { strategy: "jwt" },
  providers: [], // populated in auth.ts
};
