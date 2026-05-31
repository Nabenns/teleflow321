import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { schema } from "@lapakgram/db";
import { getDb } from "@/lib/db";
import { acceptInvite } from "@/lib/server-actions/members";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function AcceptInvitePage({ params }: Props) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  // Thin server action derives the accepting user from the session; the page
  // never passes a user id.
  const result = await acceptInvite({ token });
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Invite tidak valid</h1>
        <p className="text-sm text-slate-600">{result.reason}</p>
        <Link className="underline" href="/login">
          Kembali
        </Link>
      </div>
    );
  }

  const db = getDb();
  const [merchant] = await db
    .select({ slug: schema.merchants.slug })
    .from(schema.merchants)
    .where(eq(schema.merchants.id, result.merchantId))
    .limit(1);
  if (!merchant) redirect("/");

  redirect(`/${merchant.slug}`);
}
