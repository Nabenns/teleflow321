import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { schema } from "@lapakgram/db";
import { getDb } from "@/lib/db";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const db = getDb();
  const [user] = await db
    .select({ isAdmin: schema.users.isPlatformAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  if (!user?.isAdmin) notFound();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <Link href="/admin" className="font-bold">
          Lapakgram Admin
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/merchants">Merchants</Link>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
