import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema } from "@lapakgram/db";
import { getDb } from "@/lib/db";
import { BotSetupClient } from "./_components/bot-setup-client";

interface Props {
  params: Promise<{ merchantSlug: string }>;
}

export default async function BotSetupPage({ params }: Props) {
  const { merchantSlug } = await params;
  const db = getDb();
  const [merchant] = await db
    .select({
      id: schema.merchants.id,
      status: schema.merchants.status,
      botUsername: schema.merchants.botUsername,
    })
    .from(schema.merchants)
    .where(eq(schema.merchants.slug, merchantSlug))
    .limit(1);
  if (!merchant) notFound();

  return (
    <BotSetupClient
      merchantId={merchant.id}
      merchantSlug={merchantSlug}
      currentBotUsername={merchant.botUsername}
    />
  );
}
