# Plan 3 Design — Catalog & Mini App

**Date:** 2026-05-31
**Status:** Draft, awaiting user review
**Depends on:** Plan 1 (Foundation), Plan 2 (Auth & Merchant Onboarding)

## 1. Summary

Plan 3 builds the product catalog and the customer-facing storefront for
Lapakgram, the third increment after foundation (Plan 1) and auth/onboarding
(Plan 2).

Two complementary subsystems, both inside `apps/web` (no new service):

1. **Catalog management (dashboard)** — merchants create and manage product
   categories, products, and stock. Stock input includes a single-item form
   and bulk CSV import, with live available/sold/voided counts. Product types:
   `account` and `license_key` (text-payload stock).
2. **Mini App catalog (customer)** — a Telegram Mini App launched from the
   merchant's bot. Customers authenticate via Telegram Mini App `initData`
   (HMAC-verified with the merchant's bot token), then browse categories and
   products with accurate stock availability. Read-only in Plan 3 — checkout
   is a disabled stub wired in Plan 4.

A minimal bot change extends the Plan 2 webhook stub so `/start` replies with a
"Buka Toko" `web_app` button that launches the mini app.

**Deliverable:** a merchant can build a catalog in the dashboard; a customer
opens the bot, taps "Buka Toko", and browses a real catalog with live stock
counts in the mini app.

## 2. Goals & Non-Goals

### Goals (Plan 3)
- Category CRUD (name, slug, position, icon) per merchant
- Product CRUD (account + license_key types) with all catalog fields
- Stock management: single-item form + bulk CSV import + available/sold/voided
  counts, low-stock visual indicator (dashboard only)
- Mini App initData HMAC verification (separate verifier from the Plan 2 Login
  Widget) + customer resolve/create
- Mini App catalog browse: categories → products → product detail, with stock
  availability
- Bot `/start` replies with a "Buka Toko" web_app launch button
- Payload secrecy: `product_stocks.payload` never leaves the server to the
  dashboard list (redacted) or the mini app (absent)

### Non-Goals (deferred)
- Go bot service (Plan 4 — built alongside order/delivery handlers that need
  the throughput)
- Cart, checkout, order creation (Plan 4)
- Payment integration (Plan 4)
- Delivery: stock `available` -> `sold` transition, delivery_template
  rendering (Plan 4)
- Complaint / replace (Plan 4)
- Customer saldo / balance (Plan 5)
- Low-stock push notification via bot (Plan 4 — needs asynq/Go)
- Product type `file` + MinIO object-storage upload (deferred, separate)
- Voucher application at checkout (Plan 4)
- Reseller tiers, reviews, broadcast, affiliate (Phase 2/3)

### Success Criteria
- Merchant can create a category, a product, and add stock (manual + CSV) and
  see accurate counts
- Customer opening the mini app (via bot or test seam) sees the merchant's
  active products with correct availability and never sees stock payloads
- All catalog mutations enforce RLS + RBAC (`products:write`)
- initData verifier and CSV parser have full unit coverage; catalog server
  actions have integration coverage against a real DB

## 3. Architecture Overview

```
DASHBOARD (apps/web, server components + server actions)
  /[merchantSlug]/products
    - categories CRUD
    - products CRUD (account / license_key)
    - stock management (form + CSV + counts)
         |
         |  shared @lapakgram/db (Drizzle, RLS via setTenantContext)
         v
POSTGRES (existing) — products, product_categories, product_stocks
  (all tables already created in Plan 1; Plan 3 may add small indexes)
         ^
         |  read-only catalog queries (RLS-scoped by merchant slug)
         v
MINI APP (apps/web, /m/[merchantSlug])
    - initData verification (HMAC, merchant bot token)
    - customer resolve/create + short-lived session cookie
    - catalog browse: categories -> products -> detail
    - stock availability display (no payload)
         ^
         |  launched via "Buka Toko" web_app button
BOT WEBHOOK STUB (apps/web Next.js route, from Plan 2 Task 11)
    /start -> reply with inline web_app button -> launches mini app
    (still Next.js, NOT Go — Go service deferred to Plan 4)
```

### Key architectural decisions
- **Everything in `apps/web`.** No new service. Dashboard catalog uses the
  Plan 2 server-action pattern; mini app is a new route group `(mini-app)`;
  bot launch extends the Plan 2 webhook route.
- **Schema already exists** (Plan 1 §5.3). Plan 3 consumes `products`,
  `product_categories`, `product_stocks`. Any index additions are minor.
- **RLS respected everywhere.** All catalog mutations and dashboard reads run
  inside `setTenantContext` transactions. Mini app catalog reads are scoped to
  the merchant resolved from the slug.
- **Shared `lib/db.ts` singleton** for all new server components and actions
  (Plan 2 lesson).
- **initData verifier is a new module** `lib/auth/telegram-mini-app.ts` — pure,
  TDD-covered, with a key derivation distinct from the Login Widget.

### Why defer the Go bot service
The entire justification for the Go service is throughput (30 msg/sec/bot, many
concurrent webhooks). In Plan 3 the bot does almost nothing — `/start` replies
with a launch button. The Plan 2 Next.js webhook stub already handles `/start`.
Building the Go multi-bot router, tenant cache, FSM, and asynq scaffolds now
would be boilerplate sitting idle until Plan 4, risking wrong abstractions
before the order/delivery handlers that actually shape them exist. The Go
service is built in Plan 4 next to its first real consumer.

## 4. Catalog Data Model & Queries

### Tables used (all existing from Plan 1 §5.3)

**`product_categories`** — id, merchant_id, name, slug, position, icon_url,
created_at. Unique (merchant_id, slug).

**`products`** — id, merchant_id, category_id (nullable, FK set null), type,
name, slug, description, price_idr (int), cost_idr (int), warranty_days,
warranty_mode (auto/manual), delivery_template, is_active, position,
image_url, created_at, updated_at ($onUpdate). Unique (merchant_id, slug).

**`product_stocks`** — id, merchant_id, product_id (FK cascade), payload
(jsonb), status (available/sold/replaced/voided), sold_to_order_item_id
(nullable), imported_at, sold_at. Index (product_id, status), (merchant_id).

### Plan 3 usage vs deferred
- **Plan 3 uses:** all catalog columns. Stock is create/read only (input +
  counts by status). No transition to `sold` (that is Plan 4 delivery).
- **`delivery_template`, `warranty_*`:** set in the product form (merchant
  fills them) but consumed only in Plan 4 (delivery renders the template,
  warranty applies at complaint). Plan 3 only stores them.
- **`payload` jsonb:** for `account`: `{ email, password, profile?, notes? }`.
  For `license_key`: `{ code, notes? }`. Plan 3 stores it verbatim. The mini
  app never sees the payload; it is only delivered to the customer at purchase
  (Plan 4).

### Query layer

`apps/web/lib/server-actions/catalog.ts` (mutations) and
`apps/web/lib/queries/catalog.ts` (read-only). Mutations follow the Plan 2
pattern: a thin server action derives the actor from `auth()` and gates on
membership + RBAC, delegating to a testable inner function that takes the actor
id explicitly.

**Mutations (RLS txn, gate `products:write`):**
- `createCategory / updateCategory / deleteCategory`
- `createProduct / updateProduct / deleteProduct / toggleProductActive`
- `addStockManual` (one payload) + `addStockBulkCsv` (parse -> validate ->
  bulk insert)
- `voidStock` (mark a mis-entered stock row voided)

**Reads:**
- Dashboard: `listCategories`, `listProducts(filters)`,
  `getProduct(productId)` with stock counts, `listStock(productId)` with
  redacted payload (partial email + status, never the password)
- Mini app: `listPublicCatalog(merchantId)` (categories + active products +
  available count, NO payload), `getPublicProduct(merchantId, slug)`

### Stock count strategy
Available count per product = COUNT(*) WHERE product_id=X AND
status='available'. For a product list (N products), use one grouped query:
`SELECT product_id, status, count(*) FROM product_stocks WHERE merchant_id=X
GROUP BY product_id, status`, then map in the app. Avoids N+1.

### CSV format
- account: header `email,password,profile,notes` (profile, notes optional)
- license_key: header `code,notes` (notes optional)

Parser: split lines, validate required columns per type, collect per-row
errors (e.g. "row 5: email empty"), bulk-insert valid rows, return a summary
`{ inserted, skipped, errors[] }`. CSV is parsed transiently — never stored.
Parsing is a pure function (`lib/catalog/csv.ts`), fully unit-testable.

### Auth pattern (Plan 2 lesson, applied)
Thin server action: `await auth()` -> session.user.id -> membership lookup
(scoped to merchant) -> `can(role, "products:write")` -> delegate to the inner
`*ForActor` function which takes the actor id explicitly so tests can call it
without a NextAuth session. Coarse error reasons only (no internal leak).

## 5. Dashboard Catalog UI

All under `(dashboard)/[merchantSlug]/products/`. Server components fetch data
(RLS-scoped via session + membership); client components handle form
interactivity. Same conventions as the Plan 2 team page.

### Routing
```
(dashboard)/[merchantSlug]/products/
  page.tsx                      # product list + category filter
  new/page.tsx                  # create product form
  [productId]/
    page.tsx                    # product detail: edit form + stock panel
    _components/
      product-form.tsx          # client: edit product fields
      stock-panel.tsx           # client: counts + add form + CSV upload
      stock-list.tsx            # client: paginated stock rows (redacted)
  categories/
    page.tsx                    # category CRUD (inline list + add/edit/delete)
  _components/
    product-list.tsx            # client: table with active toggle, counts
    category-filter.tsx         # client: filter products by category
```

### Pages
- **products/page.tsx** (server): loads products + grouped stock counts +
  categories. Renders product list (name, type badge, price, available count,
  active toggle) with a category filter. "+ Produk baru" -> /new. Link to
  /categories.
- **products/new/page.tsx** (client): form with name, slug (auto from name,
  editable), type (account/license_key), category (dropdown), price_idr,
  cost_idr, description, warranty_days, warranty_mode, delivery_template
  (textarea with placeholder hints like `{email}` `{password}`), image_url.
  Submit -> createProduct -> redirect to product detail.
- **products/[productId]/page.tsx** (server): loads product + stock counts +
  first page of stock. Renders product-form (edit + save), stock-panel
  (counts; "Tambah stok" form with payload fields per product type; CSV
  upload), stock-list (paginated, redacted rows + void button on available).
- **categories/page.tsx**: inline CRUD — list (name, slug, product count), add
  form, edit inline, delete (confirm; products get category_id set null per
  the FK).

### UX details
- Type badge colour-coded (account = blue, license_key = purple)
- Active toggle optimistic (mirrors Plan 2 team role select)
- Stock counts from the grouped query; low-stock visual = red badge when
  available < 5 (threshold hardcoded for Plan 3; configurable threshold
  deferred)
- **Payload redaction mandatory** — stock list never shows a full password;
  email is partially masked (`ab***@gmail.com`), password always `••••••`.
  Full payload is delivered to the customer only at purchase (Plan 4).
- Indonesian copy; Tailwind utility classes, consistent with the existing
  Plan 2 dashboard. No design system.

### CSV upload mechanic
File input (client) reads text -> sends the string to
`addStockBulkCsv(productId, csvText)` server action -> server parses, validates,
bulk-inserts -> returns the summary -> UI shows "47 stok ditambah, 3 dilewati
(baris 5: email kosong, ...)". No file storage; the CSV is parsed transiently.

## 6. Mini App (Customer Catalog)

A Telegram Mini App is a web page rendered inside Telegram, launched from the
bot. Route group `(mini-app)/m/[merchantSlug]/`.

### initData verification (the auth layer)

When the mini app launches, Telegram injects
`window.Telegram.WebApp.initData` — a signed query string (user, auth_date,
query_id, hash). Flow:

1. Mini app client reads initData, sends it to POST /api/miniapp/session
2. Backend: look up merchant by slug -> decrypt bot token (Plan 1 crypto util)
   -> verify initData HMAC
3. HMAC derivation (DIFFERENT from the Login Widget): secret_key =
   HMAC_SHA256(key="WebAppData", data=bot_token); computed_hash =
   HMAC_SHA256(key=secret_key, data=data_check_string); compare to the hash
   field. (Login Widget in Plan 2 used secret_key = SHA256(bot_token) — hence
   a separate verifier.)
4. Check auth_date freshness (<= 24h, same pattern as Plan 2)
5. Verified -> resolve/create the customers row (merchant_id + telegram_id,
   atomic upsert per the Plan 2 pattern) -> set a short-lived signed cookie
   (customer-session JWT, distinct from the NextAuth merchant session)

New modules: lib/auth/telegram-mini-app.ts (pure verifier, TDD, parallels the
Plan 2 Telegram OAuth verifier) and lib/auth/customer-session.ts (sign/verify
the customer JWT with jose, parallels the invite token util).

### Routing
```
(mini-app)/m/[merchantSlug]/
  layout.tsx                    # mini app shell: load Telegram WebApp SDK, theme
  page.tsx                      # catalog home: categories + products
  product/[productSlug]/
    page.tsx                    # product detail (Beli = disabled Plan 4 stub)
  _components/
    telegram-init.tsx           # client: read initData, POST session, set context
    catalog-grid.tsx            # client: product grid + category tabs
    product-card.tsx            # product card (name, price, stock badge)
```

### Data flow
- Session bootstrap: telegram-init.tsx (client) on mount reads initData ->
  POST /api/miniapp/session -> backend verifies + sets cookie -> client
  proceeds. If verification fails (opened outside Telegram, bad hash), show a
  "Buka lewat bot Telegram" fallback.
- Catalog fetch: server components read the public catalog (categories +
  active products + available counts) scoped by merchant slug. No payload, no
  customer-specific data in Plan 3.
- Customer context: the cookie carries { customerId, merchantId, telegramId }.
  Plan 3 uses it minimally (proves auth works + creates the customer row);
  Plan 4 cart/checkout reads it.

### UI
- Telegram WebApp SDK (telegram-web-app.js) for theme params (match the
  user's Telegram theme), ready(), expand().
- Catalog: category tabs/pills -> product grid (card: image, name, price as
  Rp, stock badge "Tersedia 12" / "Habis"). Tap card -> product detail.
- Product detail: image, name, description, price, availability, warranty info
  ("Garansi 7 hari"). "Beli Sekarang" is a DISABLED stub with the note
  "Checkout segera hadir" (Plan 4 wires it). Keeps the page complete-looking
  without an order flow.
- Empty states: no categories/products -> "Toko ini belum menambahkan produk."
- Indonesian copy.

### Bot launch (minimal, extends the Plan 2 stub)
Extend the Plan 2 Task 11 webhook stub: on /start, reply with an inline
keyboard containing a web_app button { text: "Buka Toko", web_app: { url:
"<host>/m/<merchantSlug>" } } plus welcome text. Still Next.js, still decrypts
the merchant bot token to call sendMessage. No Go service. The merchantSlug is
resolved from the merchant row (looked up by webhookSecret).

Dev caveat: Telegram web_app buttons require the bot domain to be HTTPS and
(for production) configured. In local dev without a tunnel the button renders
but launching needs the dev URL reachable by Telegram — same caveat as the
Plan 2 bot-wizard webhook.

## 7. Testing & Cross-Cutting

### Testing strategy

**Unit (TDD-strict) — pure functions:**
- telegram-mini-app.ts initData verifier — valid payload, tampered hash, wrong
  bot token, stale auth_date, WebAppData key-derivation correctness (parallels
  the Plan 2 Telegram OAuth verifier, ~7-9 tests)
- customer-session.ts JWT sign/verify — roundtrip, expiry, wrong secret,
  malformed (parallels the Plan 2 invite token)
- csv.ts parser — valid rows, missing required column, per-row error
  collection, account vs license_key formats

**Integration (real DB via the Plan 2 test helper):**
- Catalog server actions: createCategory/Product, slug uniqueness,
  addStockManual, addStockBulkCsv (insert + skip invalid), stock-count grouped
  query correctness, voidStock
- Auth gating: a non-products:write role is blocked
- Public catalog query: returns active products + counts, asserts NO payload
  leak (payload field absent)
- Customer resolution: initData verified -> customer upsert (atomic,
  idempotent)

**E2E — agent-browser (NOT Playwright, NOT committed specs):**
The agent drives agent-browser (the vercel-labs browser-automation CLI,
installed globally) to verify flows live during implementation:
- Merchant: login -> create category -> create product -> add stock (manual +
  CSV) -> see counts
- Mini app: the agent drives the mini app via agent-browser. Since a real
  Telegram client is not available, the mini app exposes a small dev-only test
  seam: a non-production code path that accepts a pre-seeded customer session
  so the catalog can be opened directly in a browser (gated behind a
  development/test environment check; never active in production).
There are no committed *.spec.ts E2E files. CI gating stays on the vitest unit
+ integration suites (the committed source of truth). agent-browser is an
agent verification tool, run interactively during development.

### Cross-cutting
- RLS everywhere — all catalog mutations + dashboard reads via
  setTenantContext txns; public catalog query scoped by merchant slug ->
  merchant_id.
- Payload secrecy — product_stocks.payload never reaches the mini app or the
  dashboard list (redacted). Only fully delivered to the customer at purchase
  (Plan 4). A test asserts this.
- Shared lib/db.ts singleton — all new server components + actions use it.
- Auth pattern — thin server action (derive actor from auth()) + testable
  inner function (explicit ids), per the Plan 2 lessons.
- Money — price_idr/cost_idr integer (no float); formatted as Rp in the UI
  only.
- CI — the existing Postgres service (added in the Plan 2 final cleanup)
  covers the new integration tests. No CI change needed.
- .env.example — add CUSTOMER_SESSION_SECRET (32-byte base64, signs the
  customer JWT; separate from NEXTAUTH_SECRET and INVITE_SIGNING_SECRET). The
  mini-app dev test seam is gated on the existing NODE_ENV check, no new env
  var for it.

## 8. Out of Scope (explicit)

Reserved schema already exists for several of these, so no large migration is
needed later, but the logic/UI is not built in Plan 3:

- Go bot service (Plan 4)
- Cart, checkout, order creation (Plan 4)
- Payment integration (Plan 4)
- Delivery: stock available -> sold transition, delivery_template rendering
  (Plan 4)
- Complaint / replace (Plan 4)
- Customer saldo / balance (Plan 5)
- Low-stock push notification via bot (Plan 4)
- Product type file + MinIO upload (deferred, separate)
- Voucher application at checkout (Plan 4)
- Reseller tiers, reviews, broadcast, affiliate (Phase 2/3)
- Configurable low-stock threshold (hardcoded 5 in Plan 3)

## 9. Estimated Scope

~13-15 tasks, sized like Plan 2: initData verifier (TDD), customer session
(TDD), CSV parser (TDD), catalog mutations + reads, category UI, product UI,
stock panel + CSV upload UI, mini app session route, mini app catalog UI, bot
launch button. E2E verification via agent-browser is interactive, not a task
that commits test files.
