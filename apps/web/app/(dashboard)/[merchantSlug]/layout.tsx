import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { auth } from "@/auth";
import { createDb, schema } from "@lapakgram/db";
import { MerchantSwitcher } from "../_components/merchant-switcher";
import { listMerchantsForUser } from "@/lib/server-actions/merchant";

interface Props {
  children: ReactNode;
  params: Promise<{ merchantSlug: string }>;
}

export default async function MerchantLayout({ children, params }: Props) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const { merchantSlug } = await params;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const db = createDb(databaseUrl);

  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.slug, merchantSlug))
    .limit(1);
  if (!merchant) notFound();

  const [membership] = await db
    .select({ role: schema.merchantMembers.role })
    .from(schema.merchantMembers)
    .where(
      and(
        eq(schema.merchantMembers.merchantId, merchant.id),
        eq(schema.merchantMembers.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!membership) notFound();

  const list = await listMerchantsForUser(session.user.id);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href={`/${merchant.slug}`} className="font-bold">
            {merchant.name}
          </Link>
          <MerchantSwitcher items={list} active={merchant.slug} />
        </div>
        <nav className="flex gap-4 text-sm">
          <Link href={`/${merchant.slug}`}>Overview</Link>
          <Link href={`/${merchant.slug}/settings/bot`}>Bot</Link>
          <Link href={`/${merchant.slug}/settings/team`}>Team</Link>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
