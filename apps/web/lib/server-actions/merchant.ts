"use server";

import { eq } from "drizzle-orm";
import { createDb, schema, type LapakgramDb } from "@lapakgram/db";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,31}$/;
const TRIAL_DAYS = 14;

// Memoized per-URL DB pool. Server actions are invoked many times per
// process; without this, each call would spawn a fresh postgres-js pool.
let cached: { url: string; db: LapakgramDb } | null = null;
function getDb(): LapakgramDb {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  if (cached?.url === url) return cached.db;
  cached = { url, db: createDb(url) };
  return cached.db;
}

export type CreateResult =
  | { ok: true; merchantId: string; slug: string }
  | { ok: false; reason: string };

export async function createMerchant(input: {
  userId: string;
  name: string;
  slug: string;
}): Promise<CreateResult> {
  const slug = input.slug.toLowerCase().trim();
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      reason: "slug must be 3-32 chars, lowercase a-z, 0-9, dash",
    };
  }
  if (input.name.trim().length === 0) {
    return { ok: false, reason: "name required" };
  }
  const db = getDb();

  const [existingSlug] = await db
    .select({ id: schema.merchants.id })
    .from(schema.merchants)
    .where(eq(schema.merchants.slug, slug))
    .limit(1);
  if (existingSlug) return { ok: false, reason: "slug already taken" };

  // Find or create the trial plan. One-time bootstrap kept outside the
  // merchant transaction since it's idempotent and shared across all
  // merchants.
  let [trialPlan] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.code, "trial"))
    .limit(1);
  if (!trialPlan) {
    [trialPlan] = await db
      .insert(schema.plans)
      .values({
        code: "trial",
        name: "Trial",
        monthlyPriceIdr: 0,
        yearlyPriceIdr: 0,
        transactionFeeBps: 0,
        limits: { trial: true } as unknown as object,
      })
      .returning({ id: schema.plans.id });
    if (!trialPlan) return { ok: false, reason: "could not create trial plan" };
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000);
  const planId = trialPlan.id;

  // Wrap merchant + ownership + subscription inserts in a single txn so a
  // partial state (merchant without owner, or merchant without subscription)
  // can never be observed.
  const merchantId = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(schema.merchants)
      .values({
        slug,
        name: input.name.trim(),
        planId,
        trialEndsAt,
        status: "pending_setup",
      })
      .returning({ id: schema.merchants.id });
    if (!m) throw new Error("merchant insert failed");

    await tx.insert(schema.merchantMembers).values({
      merchantId: m.id,
      userId: input.userId,
      role: "owner",
      acceptedAt: new Date(),
    });

    await tx.insert(schema.subscriptions).values({
      merchantId: m.id,
      planId,
      billingCycle: "monthly",
      status: "trialing",
      currentPeriodEnd: trialEndsAt,
    });

    return m.id;
  });

  return { ok: true, merchantId, slug };
}

export interface MerchantListItem {
  merchantId: string;
  slug: string;
  name: string;
  role: string;
  status: string;
}

export async function listMerchantsForUser(
  userId: string,
): Promise<MerchantListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      merchantId: schema.merchants.id,
      slug: schema.merchants.slug,
      name: schema.merchants.name,
      role: schema.merchantMembers.role,
      status: schema.merchants.status,
    })
    .from(schema.merchantMembers)
    .innerJoin(
      schema.merchants,
      eq(schema.merchantMembers.merchantId, schema.merchants.id),
    )
    .where(eq(schema.merchantMembers.userId, userId));
  return rows;
}
