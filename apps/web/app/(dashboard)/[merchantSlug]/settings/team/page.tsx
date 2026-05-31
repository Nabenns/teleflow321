import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { schema } from "@lapakgram/db";
import { getDb } from "@/lib/db";
import { listMembers } from "@/lib/server-actions/members";
import { TeamClient } from "./_components/team-client";

interface Props {
  params: Promise<{ merchantSlug: string }>;
}

export default async function TeamPage({ params }: Props) {
  const { merchantSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();

  const db = getDb();
  const [merchant] = await db
    .select({ id: schema.merchants.id })
    .from(schema.merchants)
    .where(eq(schema.merchants.slug, merchantSlug))
    .limit(1);
  if (!merchant) notFound();

  // Thin server action derives the actor from the session; the page never
  // passes a user id for authorization. actorUserId below is only a UI hint to
  // disable self-row edits — the real check happens server-side.
  const list = await listMembers({ merchantId: merchant.id });
  if (!list.ok) return <p>{list.reason}</p>;

  return (
    <TeamClient merchantId={merchant.id} members={list.members} actorUserId={session.user.id} />
  );
}
