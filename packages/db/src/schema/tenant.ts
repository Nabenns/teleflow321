import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { merchants, users } from "./platform.js";

// ============================================================
// customers
// ============================================================
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    telegramId: bigint("telegram_id", { mode: "bigint" }).notNull(),
    telegramUsername: text("telegram_username"),
    fullName: text("full_name"),
    phone: text("phone"),
    resellerTierId: uuid("reseller_tier_id"),
    balanceIdr: bigint("balance_idr", { mode: "number" }).notNull().default(0),
    totalSpentIdr: bigint("total_spent_idr", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    merchantTelegramIdx: uniqueIndex("customers_merchant_telegram_idx").on(
      t.merchantId,
      t.telegramId,
    ),
    merchantIdx: index("customers_merchant_idx").on(t.merchantId),
  }),
);

// ============================================================
// product_categories
// ============================================================
export const productCategories = pgTable(
  "product_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    iconUrl: text("icon_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantSlugIdx: uniqueIndex("product_categories_merchant_slug_idx").on(t.merchantId, t.slug),
  }),
);

// ============================================================
// products
// ============================================================
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => productCategories.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    priceIdr: integer("price_idr").notNull(),
    costIdr: integer("cost_idr").notNull().default(0),
    warrantyDays: integer("warranty_days").notNull().default(0),
    warrantyMode: text("warranty_mode").notNull().default("auto"),
    deliveryTemplate: text("delivery_template"),
    isActive: boolean("is_active").notNull().default(true),
    position: integer("position").notNull().default(0),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    merchantSlugIdx: uniqueIndex("products_merchant_slug_idx").on(t.merchantId, t.slug),
    merchantCategoryIdx: index("products_merchant_category_idx").on(t.merchantId, t.categoryId),
  }),
);

// ============================================================
// product_stocks
// ============================================================
export const productStocks = pgTable(
  "product_stocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("available"),
    soldToOrderItemId: uuid("sold_to_order_item_id"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
  },
  (t) => ({
    productStatusIdx: index("product_stocks_product_status_idx").on(t.productId, t.status),
    merchantIdx: index("product_stocks_merchant_idx").on(t.merchantId),
  }),
);

// ============================================================
// product_files
// ============================================================
export const productFiles = pgTable(
  "product_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    productIdx: index("product_files_product_idx").on(t.productId),
  }),
);

// ============================================================
// vouchers
// ============================================================
export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    discountType: text("discount_type").notNull(),
    discountValue: integer("discount_value").notNull(),
    maxDiscountIdr: integer("max_discount_idr"),
    minPurchaseIdr: integer("min_purchase_idr"),
    usageLimit: integer("usage_limit"),
    usageCount: integer("usage_count").notNull().default(0),
    perCustomerLimit: integer("per_customer_limit"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    productScope: text("product_scope").notNull().default("all"),
    scopeIds: uuid("scope_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantCodeIdx: uniqueIndex("vouchers_merchant_code_idx").on(t.merchantId, t.code),
  }),
);

// ============================================================
// orders
// ============================================================
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    orderNumber: text("order_number").notNull(),
    status: text("status").notNull().default("pending_payment"),
    paymentMethod: text("payment_method").notNull(),
    subtotalIdr: integer("subtotal_idr").notNull(),
    discountIdr: integer("discount_idr").notNull().default(0),
    totalIdr: integer("total_idr").notNull(),
    platformFeeIdr: integer("platform_fee_idr").notNull().default(0),
    voucherId: uuid("voucher_id").references(() => vouchers.id, { onDelete: "set null" }),
    pgReference: text("pg_reference"),
    pgStatus: text("pg_status"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    merchantNumberIdx: uniqueIndex("orders_merchant_number_idx").on(t.merchantId, t.orderNumber),
    merchantStatusIdx: index("orders_merchant_status_idx").on(t.merchantId, t.status),
    customerIdx: index("orders_customer_idx").on(t.customerId),
    pgRefIdx: index("orders_pg_ref_idx").on(t.pgReference),
  }),
);

// ============================================================
// order_items
// ============================================================
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productSnapshot: jsonb("product_snapshot").notNull(),
    qty: integer("qty").notNull().default(1),
    unitPriceIdr: integer("unit_price_idr").notNull(),
    deliveredPayload: jsonb("delivered_payload"),
    warrantyUntil: timestamp("warranty_until", { withTimezone: true }),
  },
  (t) => ({
    orderIdx: index("order_items_order_idx").on(t.orderId),
    merchantIdx: index("order_items_merchant_idx").on(t.merchantId),
    productIdx: index("order_items_product_idx").on(t.productId),
  }),
);

// ============================================================
// balance_topups
// ============================================================
export const balanceTopups = pgTable(
  "balance_topups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    amountIdr: integer("amount_idr").notNull(),
    status: text("status").notNull().default("pending"),
    paymentMethod: text("payment_method").notNull(),
    pgReference: text("pg_reference"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    customerIdx: index("balance_topups_customer_idx").on(t.customerId),
    merchantIdx: index("balance_topups_merchant_idx").on(t.merchantId),
    pgRefIdx: index("balance_topups_pg_ref_idx").on(t.pgReference),
  }),
);

// ============================================================
// balance_transactions (ledger)
// ============================================================
export const balanceTransactions = pgTable(
  "balance_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    amountIdr: bigint("amount_idr", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    customerIdx: index("balance_transactions_customer_idx").on(t.customerId),
    merchantIdx: index("balance_transactions_merchant_idx").on(t.merchantId),
  }),
);

// ============================================================
// complaints
// ============================================================
export const complaints = pgTable(
  "complaints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    replacementStockId: uuid("replacement_stock_id"),
    handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    orderItemIdx: index("complaints_order_item_idx").on(t.orderItemId),
    customerIdx: index("complaints_customer_idx").on(t.customerId),
    merchantStatusIdx: index("complaints_merchant_status_idx").on(t.merchantId, t.status),
  }),
);

// ============================================================
// merchant_payouts
// ============================================================
export const merchantPayouts = pgTable(
  "merchant_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    amountIdr: bigint("amount_idr", { mode: "number" }).notNull(),
    bankCode: text("bank_code").notNull(),
    accountNumber: text("account_number").notNull(),
    accountHolder: text("account_holder").notNull(),
    status: text("status").notNull().default("requested"),
    pgDisbursementRef: text("pg_disbursement_ref"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantStatusIdx: index("merchant_payouts_merchant_status_idx").on(
      t.merchantId,
      t.status,
    ),
  }),
);

// ============================================================
// merchant_balances
// ============================================================
export const merchantBalances = pgTable("merchant_balances", {
  merchantId: uuid("merchant_id")
    .primaryKey()
    .references(() => merchants.id, { onDelete: "restrict" }),
  availableIdr: bigint("available_idr", { mode: "number" }).notNull().default(0),
  pendingIdr: bigint("pending_idr", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ============================================================
// audit_logs
// ============================================================
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    changes: jsonb("changes"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantCreatedIdx: index("audit_logs_merchant_created_idx").on(t.merchantId, t.createdAt),
    userIdx: index("audit_logs_user_idx").on(t.userId),
  }),
);
