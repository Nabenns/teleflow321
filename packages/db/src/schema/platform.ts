import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Custom type for AES-GCM encrypted blobs (BYTEA).
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ============================================================
// users
// ============================================================
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").unique(),
    passwordHash: text("password_hash"),
    telegramId: bigint("telegram_id", { mode: "bigint" }).unique(),
    telegramUsername: text("telegram_username"),
    fullName: text("full_name"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    telegramIdIdx: uniqueIndex("users_telegram_id_idx").on(t.telegramId),
  }),
);

// ============================================================
// plans
// ============================================================
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    monthlyPriceIdr: integer("monthly_price_idr").notNull().default(0),
    yearlyPriceIdr: integer("yearly_price_idr").notNull().default(0),
    transactionFeeBps: integer("transaction_fee_bps").notNull().default(0),
    limits: jsonb("limits").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("plans_code_idx").on(t.code),
  }),
);

// ============================================================
// merchants
// ============================================================
export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    botTokenEncrypted: bytea("bot_token_encrypted"),
    botTokenKeyVersion: integer("bot_token_key_version").notNull().default(1),
    botUsername: text("bot_username"),
    botId: bigint("bot_id", { mode: "bigint" }),
    webhookSecret: text("webhook_secret"),
    webhookTelegramSecret: text("webhook_telegram_secret"),
    status: text("status").notNull().default("pending_setup"),
    planId: uuid("plan_id").references(() => plans.id),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    slugIdx: uniqueIndex("merchants_slug_idx").on(t.slug),
    webhookSecretIdx: index("merchants_webhook_secret_idx").on(t.webhookSecret),
    botIdIdx: index("merchants_bot_id_idx").on(t.botId),
    planIdIdx: index("merchants_plan_id_idx").on(t.planId),
  }),
);

// ============================================================
// merchant_members
// ============================================================
export const merchantMembers = pgTable(
  "merchant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => ({
    uniq: uniqueIndex("merchant_members_merchant_user_idx").on(t.merchantId, t.userId),
    userIdx: index("merchant_members_user_idx").on(t.userId),
  }),
);

// ============================================================
// subscriptions
// ============================================================
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .unique()
      .references(() => merchants.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    billingCycle: text("billing_cycle").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    planIdIdx: index("subscriptions_plan_id_idx").on(t.planId),
  }),
);

// ============================================================
// platform_invoices
// ============================================================
export const platformInvoices = pgTable(
  "platform_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    amountIdr: integer("amount_idr").notNull(),
    status: text("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    pgReference: text("pg_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantIdx: index("platform_invoices_merchant_idx").on(t.merchantId),
    pgRefIdx: index("platform_invoices_pg_ref_idx").on(t.pgReference),
  }),
);

// ============================================================
// relations
// ============================================================
export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(merchantMembers),
}));

export const merchantsRelations = relations(merchants, ({ many, one }) => ({
  members: many(merchantMembers),
  plan: one(plans, { fields: [merchants.planId], references: [plans.id] }),
  subscription: one(subscriptions),
}));

export const merchantMembersRelations = relations(merchantMembers, ({ one }) => ({
  merchant: one(merchants, {
    fields: [merchantMembers.merchantId],
    references: [merchants.id],
  }),
  user: one(users, {
    fields: [merchantMembers.userId],
    references: [users.id],
  }),
}));
