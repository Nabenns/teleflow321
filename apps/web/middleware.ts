import NextAuth from "next-auth";
import { authConfig } from "./auth.config.js";

// Edge runtime: only the edge-safe authConfig is wired here. It must NOT
// import ./auth (Credentials provider pulls in bcrypt + postgres, which break
// the edge runtime). The `authorized` callback in auth.config.ts gates the
// dashboard; this just runs that callback before pages render.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
