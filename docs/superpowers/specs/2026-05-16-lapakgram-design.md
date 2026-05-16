# Lapakgram — Design Spec

**Date:** 2026-05-16
**Status:** Draft, awaiting user review
**Project:** Lapakgram — Multi-tenant SaaS for Telegram-based digital product stores

## 1. Summary

Lapakgram adalah SaaS platform yang ngebantu merchant Indonesia jualan produk
digital (akun premium, file, license key, top up, jasa custom) lewat bot
Telegram mereka sendiri. Tiap merchant dapet:

- Bot Telegram sendiri (bring-your-own-token via @BotFather)
- Mini App e-commerce di Telegram untuk customer mereka
- Dashboard web untuk manage produk, stok, order, customer, balance, dan team
- Auto-delivery, garansi & replace, sistem saldo customer, voucher promo

Platform monetize via hybrid model: subscription bulanan/tahunan + transaction
fee per order. Platform jadi merchant of record (uang masuk ke akun PG
platform), settle ke merchant via payout/withdrawal flow.

Sister product dari Lapakflow (Shopee version) — brand family `Lapak[platform]`.

## 2. Goals & Non-Goals

### Goals (MVP)
- Onboarding merchant <10 menit dari sign up sampai bot online dengan minimal 1
  produk siap jual
- Auto-delivery akun premium / file / license key dalam <5 detik setelah order
  paid
- Garansi & replace flow yang reliable, hybrid mode (auto-replace default,
  manual-approval opt-in per produk)
- Sistem saldo customer (top up + bayar pake saldo) untuk retensi
- Multi-admin per merchant dengan role (owner, admin, finance, support)
- Voucher / kode promo dengan scope flexible (all / category / product)
- Platform admin panel buat operate platform (manage merchant, billing,
  dispute)
- Self-hosted di VPS pake Docker + Coolify

### Non-Goals (MVP)
- Multi-level reseller / harga tier (phase 2)
- Review & rating produk (phase 2)
- Affiliate / referral program (phase 3)
- Broadcast & retention messaging (phase 3)
- PPOB / H2H supplier integration (separate analysis per supplier)
- Custom service / jasa workflow (manual fulfillment, ticket-based)
- Mobile native app (mini app + responsive dashboard cukup)
- White-label custom domain
- Multi-currency (IDR-only)

### Success Criteria
- 5 merchant beta aktif jualan beneran dalam 4 minggu post-launch
- Auto-delivery success rate ≥99% dalam 30 hari pertama production
- Zero cross-tenant data leak (verified via RLS test suite)
- Webhook → reply latency p95 <800ms

## 3. Target Users

**Primary:** Toko premium menengah-besar (puluhan merchant target tahun 1).
Ratusan-ribuan transaksi per hari per merchant. Punya tim operasi (multi-admin
wajib). Mau brand bot sendiri.

**Secondary:** Platform admin (owner Lapakgram) yang manage merchant onboarding,
billing, dispute, payout approval.

## 4. Architecture Overview

### 4.1 Components

```
                          ┌──────────────────────────┐
                          │  Telegram (BotFather)    │
                          │  Bot per merchant        │
                          └────────┬─────────────────┘
                                   │ webhooks
                                   ▼
┌─────────────┐         ┌─────────────────────┐         ┌──────────────────┐
│  Customer   │ ◀───▶   │  bot-service (Go)   │ ◀──▶    │  Postgres        │
│  (Telegram) │         │  - webhook router   │         │  - shared DB     │
└─────────────┘         │  - command handler  │         │  - RLS by tenant │
       │                │  - delivery worker  │         └──────────────────┘
       │ Mini App       │  - replace handler  │                  ▲
       ▼                └──────┬──────────────┘                  │
┌─────────────┐                │                                 │
│ Mini App    │                │ shared queue/cache              │
│ (Next.js)   │                ▼                                 │
└──────┬──────┘         ┌─────────────────────┐                  │
       │                │  Redis              │                  │
       │ REST           │  - asynq job queue  │                  │
       ▼                │  - rate limit       │                  │
┌──────────────────────┐│  - session FSM      │                  │
│  web (Next.js)       │└─────────────────────┘                  │
│  - dashboard merchant│                                         │
│  - mini app pages    │─────────────────────────────────────────┘
│  - REST API          │
│  - admin platform    │
└──────────┬───────────┘
           │
           ▼
   ┌───────────────┐
   │  Payment GW   │  (Tripay default; adapter for Midtrans/Xendit)
   └───────────────┘
```

### 4.2 Services

**`web` (Next.js 15+, TypeScript)**
- Dashboard merchant (`app.lapakgram.id` atau `lapakgram.id/dashboard`)
- Mini App customer (`lapakgram.id/m/[merchantSlug]`)
- REST API (`/api/v1/*` public, `/api/internal/*` service-to-service)
- Platform admin panel (`/admin`)
- Auth: NextAuth v5 (email + Telegram OAuth, no Google)

**`bot-service` (Go)**
- Single binary multi-bot webhook handler
- Endpoint: `POST /webhook/{webhook_secret}`
- Background worker mode: `--worker` flag, consume asynq queue
- Library: `gotgbot` untuk Telegram API
- Stateless, horizontally scalable

### 4.3 Infrastructure

| Component | Tech | Notes |
|---|---|---|
| Database | Postgres 16 | Single instance, shared schema, RLS by `merchant_id` |
| Queue / cache | Redis 7 | asynq queue, rate limiter, session FSM, idempotency |
| Object storage | MinIO (self-hosted, S3-compatible) | File produk, foto, attachment komplain |
| Container orchestration | Coolify on Hetzner VPS | CPX21-CPX31 cukup buat MVP |
| Deploy unit | Docker images via GHCR | CI = GitHub Actions, auto-pull on tag |

### 4.4 Service Communication

- **Sync read-heavy**: bot-service query Postgres langsung (catalog, customer,
  order). Lebih cepet, fewer hops.
- **Sync write commands**: bot-service → web internal API (`POST
  /api/internal/*`) untuk operasi yang punya business logic kompleks (create
  order, deduct balance). Auth: shared service token (`X-Service-Token`).
- **Async events**: kedua service share Redis (asynq queue). Web enqueue job,
  bot-service consume.

### 4.5 Why Go for bot-service

- Handle ratusan-ribuan webhook concurrent dengan RAM minim (~50-100MB)
- Hot path Telegram update parsing harus low-latency
- Long-running connection ke Telegram lebih stabil di Go runtime
- Single static binary, mudah deploy

## 5. Data Model

### 5.1 Tenancy & RLS Strategy

- Tabel "tenant data" punya kolom `merchant_id UUID NOT NULL`
- RLS policy:
  ```sql
  CREATE POLICY tenant_isolation ON <table>
  USING (merchant_id = current_setting('app.current_merchant_id')::uuid);
  ```
- Web: set `SET LOCAL app.current_merchant_id = '...'` di setiap
  authenticated request transaction
- Bot service: set berdasarkan token bot yang trigger webhook
- Platform-level tables (users, merchants, plans, dll) tanpa RLS, query pake
  filter eksplisit

### 5.2 Platform-Level Tables

```sql
-- User akun (merchant owner, staff, atau platform admin)
users (
  id UUID PK,
  email TEXT UNIQUE,
  password_hash TEXT NULL,            -- nullable jika pure Telegram OAuth
  telegram_id BIGINT UNIQUE NULL,     -- nullable jika pure email
  telegram_username TEXT,
  full_name TEXT,
  email_verified_at TIMESTAMPTZ,
  is_platform_admin BOOLEAN DEFAULT false,
  created_at, updated_at TIMESTAMPTZ
)

-- Merchant = toko, satu user bisa punya/jadi staff banyak merchant
merchants (
  id UUID PK,
  slug TEXT UNIQUE,                   -- buat URL mini app: /m/<slug>
  name TEXT,
  bot_token_encrypted BYTEA,          -- AES-GCM encrypted
  bot_username TEXT,
  bot_id BIGINT,
  webhook_secret TEXT,                -- random, dipake di URL webhook
  webhook_telegram_secret TEXT,       -- header X-Telegram-Bot-Api-Secret-Token
  status TEXT,                        -- 'pending_setup' | 'active' | 'suspended'
  plan_id UUID FK plans,
  trial_ends_at TIMESTAMPTZ,
  created_at, updated_at TIMESTAMPTZ
)

-- Membership user ke merchant (multi-admin support)
merchant_members (
  id UUID PK,
  merchant_id UUID FK,
  user_id UUID FK,
  role TEXT,                          -- 'owner' | 'admin' | 'finance' | 'support'
  invited_at, accepted_at TIMESTAMPTZ,
  UNIQUE (merchant_id, user_id)
)

-- Plan SaaS subscription
plans (
  id UUID PK,
  code TEXT UNIQUE,                   -- 'trial', 'basic', 'pro', 'enterprise'
  name TEXT,
  monthly_price_idr INT,
  yearly_price_idr INT,
  transaction_fee_bps INT,            -- basis points (200 = 2%)
  limits JSONB                        -- { max_products, max_tx_per_month, ... }
)

-- Subscription aktif merchant
subscriptions (
  id UUID PK,
  merchant_id UUID FK UNIQUE,
  plan_id UUID FK,
  billing_cycle TEXT,                 -- 'monthly' | 'yearly'
  status TEXT,                        -- 'trialing' | 'active' | 'past_due' | 'canceled'
  current_period_end TIMESTAMPTZ,
  created_at, updated_at TIMESTAMPTZ
)

-- Pembayaran subscription / settlement transaction fee
platform_invoices (
  id UUID PK,
  merchant_id UUID FK,
  type TEXT,                          -- 'subscription' | 'transaction_fee_settlement'
  amount_idr INT,
  status TEXT,                        -- 'pending' | 'paid' | 'failed'
  paid_at TIMESTAMPTZ,
  pg_reference TEXT,
  created_at TIMESTAMPTZ
)
```

### 5.3 Tenant-Scoped Tables (RLS-protected)

```sql
-- Customer: end user yang chat ke bot merchant
customers (
  id UUID PK,
  merchant_id UUID FK,
  telegram_id BIGINT,
  telegram_username TEXT,
  full_name TEXT,
  phone TEXT,
  reseller_tier_id UUID FK NULL,      -- reserved phase 2
  balance_idr BIGINT DEFAULT 0,
  total_spent_idr BIGINT DEFAULT 0,
  created_at, updated_at TIMESTAMPTZ,
  UNIQUE (merchant_id, telegram_id)
)

product_categories (
  id UUID PK,
  merchant_id UUID FK,
  name TEXT,
  slug TEXT,
  position INT,
  icon_url TEXT,
  UNIQUE (merchant_id, slug)
)

products (
  id UUID PK,
  merchant_id UUID FK,
  category_id UUID FK,
  type TEXT,                          -- 'account' | 'file' | 'license_key' | 'topup' | 'service'
  name TEXT,
  slug TEXT,
  description TEXT,
  price_idr INT,
  cost_idr INT,                       -- HPP, untuk reporting
  warranty_days INT DEFAULT 0,
  warranty_mode TEXT,                 -- 'auto' | 'manual'
  delivery_template TEXT,             -- Markdown dengan placeholder
  is_active BOOLEAN DEFAULT true,
  position INT,
  image_url TEXT,
  created_at, updated_at TIMESTAMPTZ,
  UNIQUE (merchant_id, slug)
)

-- Stok per produk (type 'account', 'license_key')
product_stocks (
  id UUID PK,
  merchant_id UUID FK,
  product_id UUID FK,
  payload JSONB,                      -- { email, password, profile, notes } / { code }
  status TEXT,                        -- 'available' | 'sold' | 'replaced' | 'voided'
  sold_to_order_item_id UUID NULL,
  imported_at TIMESTAMPTZ,
  sold_at TIMESTAMPTZ
)

-- File untuk produk type 'file'
product_files (
  id UUID PK,
  merchant_id UUID FK,
  product_id UUID FK,
  file_key TEXT,                      -- S3/MinIO object key
  file_name TEXT,
  size_bytes BIGINT,
  uploaded_at TIMESTAMPTZ
)

orders (
  id UUID PK,
  merchant_id UUID FK,
  customer_id UUID FK,
  order_number TEXT,                  -- 'LPK-{merchantShortId}-{YYYYMM}-{seq}'
  status TEXT,                        -- 'pending_payment' | 'paid' | 'delivered' | 'failed' | 'refunded' | 'cancelled'
  payment_method TEXT,                -- 'pg' | 'balance'
  subtotal_idr INT,
  discount_idr INT,
  total_idr INT,
  platform_fee_idr INT,
  voucher_id UUID FK NULL,
  pg_reference TEXT,
  pg_status TEXT,
  paid_at, delivered_at TIMESTAMPTZ,
  created_at, updated_at TIMESTAMPTZ
)

order_items (
  id UUID PK,
  merchant_id UUID FK,
  order_id UUID FK,
  product_id UUID FK,
  product_snapshot JSONB,
  qty INT,
  unit_price_idr INT,
  delivered_payload JSONB,            -- isi yang dikirim ke customer
  warranty_until TIMESTAMPTZ
)

vouchers (
  id UUID PK,
  merchant_id UUID FK,
  code TEXT,
  discount_type TEXT,                 -- 'percent' | 'fixed'
  discount_value INT,
  max_discount_idr INT NULL,
  min_purchase_idr INT NULL,
  usage_limit INT NULL,
  usage_count INT DEFAULT 0,
  per_customer_limit INT NULL,
  starts_at, expires_at TIMESTAMPTZ,
  product_scope TEXT,                 -- 'all' | 'category' | 'product'
  scope_ids UUID[],
  is_active BOOLEAN DEFAULT true,
  UNIQUE (merchant_id, code)
)

balance_topups (
  id UUID PK,
  merchant_id UUID FK,
  customer_id UUID FK,
  amount_idr INT,
  status TEXT,                        -- 'pending' | 'paid' | 'failed'
  payment_method TEXT,
  pg_reference TEXT,
  paid_at, created_at TIMESTAMPTZ
)

balance_transactions (
  id UUID PK,
  merchant_id UUID FK,
  customer_id UUID FK,
  type TEXT,                          -- 'topup' | 'purchase' | 'refund' | 'adjustment'
  amount_idr BIGINT,                  -- positive=credit, negative=debit
  balance_after BIGINT,
  reference_type TEXT,                -- 'order' | 'topup' | 'admin'
  reference_id UUID,
  created_at TIMESTAMPTZ
)

complaints (
  id UUID PK,
  merchant_id UUID FK,
  order_item_id UUID FK,
  customer_id UUID FK,
  reason TEXT,
  status TEXT,                        -- 'open' | 'auto_resolved' | 'pending_review' | 'resolved' | 'rejected'
  resolution TEXT,                    -- 'replaced' | 'refunded' | 'rejected'
  replacement_stock_id UUID NULL,
  handled_by UUID NULL,
  created_at, resolved_at TIMESTAMPTZ
)

merchant_payouts (
  id UUID PK,
  merchant_id UUID FK,
  amount_idr BIGINT,
  bank_code TEXT,
  account_number TEXT,
  account_holder TEXT,
  status TEXT,                        -- 'requested' | 'processing' | 'paid' | 'rejected'
  pg_disbursement_ref TEXT,
  requested_by UUID,
  processed_at, created_at TIMESTAMPTZ
)

merchant_balances (
  merchant_id UUID PK,
  available_idr BIGINT DEFAULT 0,
  pending_idr BIGINT DEFAULT 0,       -- holding period 1 hari setelah delivered
  updated_at TIMESTAMPTZ
)

audit_logs (
  id UUID PK,
  merchant_id UUID FK,
  user_id UUID FK,
  action TEXT,
  entity_type TEXT,
  entity_id UUID,
  changes JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ
)
```

### 5.4 Money Handling

- Semua amount IDR disimpan sebagai integer (rupiah, no desimal). Tidak pake
  float.
- Balance customer: cache di `customers.balance_idr` + ledger lengkap di
  `balance_transactions`. Setiap mutasi dilakukan dalam 1 transaction Postgres
  (write ke kedua tabel atomik). Trigger validasi: `balance_after` di ledger
  harus = sum sebelumnya + amount.
- Merchant balance: `merchant_balances.pending_idr` += order.total - platform_fee
  saat delivered. Cron job harian pindahin pending → available setelah hold
  period.

### 5.5 Encryption at Rest

- `merchants.bot_token_encrypted` (BYTEA): AES-256-GCM, master key dari env
  (`MASTER_ENCRYPTION_KEY`, 32 byte). Setiap encrypt punya nonce unik (12 byte)
  prepended di ciphertext.
- Bank account number di `merchant_payouts`: same approach.
- Master key rotation: out of scope MVP, tapi schema support multi-key (ada
  kolom `key_version` di tiap encrypted field — direservasi tapi gak dipake
  v1).

## 6. Bot Service Design

### 6.1 Webhook Routing

```
POST /webhook/{webhook_secret}
Header: X-Telegram-Bot-Api-Secret-Token: {webhook_telegram_secret}
```

Flow:
1. Lookup merchant by `webhook_secret` (cache: Redis 5 menit, fallback DB)
2. Verify `X-Telegram-Bot-Api-Secret-Token` matches `webhook_telegram_secret`
3. Parse Telegram Update JSON
4. Idempotency: cek `update_id` in Redis set (`idem:bot:{bot_id}`, TTL 1h).
   Skip kalo udah ada.
5. Dispatch ke handler berdasarkan update type
6. Ack 200 OK secepat mungkin (<2s, atau Telegram retry)

### 6.2 Internal Modules

```
bot-service/
├── cmd/
│   ├── server/        # HTTP webhook server
│   └── worker/        # Background asynq worker
├── internal/
│   ├── tenant/        # merchant lookup + cache
│   ├── telegram/      # gotgbot wrapper, multi-bot client pool
│   ├── handler/
│   │   ├── start.go
│   │   ├── catalog.go
│   │   ├── order.go
│   │   ├── balance.go
│   │   ├── complaint.go
│   │   └── admin.go        # commands buat merchant admin di bot mereka
│   ├── job/
│   │   ├── delivery.go
│   │   ├── replace.go
│   │   ├── reminder.go
│   │   └── payment_retry.go
│   ├── ratelimit/     # token bucket per bot + per chat
│   ├── session/       # FSM state per (bot, chat) di Redis
│   ├── repo/          # sqlc-generated queries
│   └── api/           # Internal HTTP client ke web service
└── pkg/config/
```

### 6.3 Conversation State (FSM)

- Key: `session:{bot_id}:{chat_id}`
- Value: JSON `{ state: string, data: object, expires_at: ts }`
- TTL: 30 menit, refresh per interaction
- States contoh:
  - `idle`
  - `awaiting_voucher_code`
  - `awaiting_topup_amount`
  - `awaiting_complaint_reason:{order_item_id}`

### 6.4 Background Jobs (asynq)

| Job | Trigger | Description |
|---|---|---|
| `delivery` | `orders.status` → `paid` | Pull stok / file, deliver via Telegram |
| `replace` | Customer komplain (warranty_mode=auto) | Pull stok ganti, deliver |
| `notify_low_stock` | Cron 5 menit | Alert merchant via bot kalo stok < threshold |
| `notify_warranty_expiring` | Cron 1x sehari | Reminder customer "garansi 1 hari lagi". Job dibangun di MVP, tapi default OFF di tiap merchant. Merchant aktifkan di settings (boolean toggle). |
| `payment_webhook_retry` | PG webhook fail di web | Retry update order |
| `move_pending_to_available` | Cron harian | Pindah balance setelah hold period |

### 6.5 Rate Limiting

- Telegram global: 30 msg/sec/bot, 1 msg/sec per chat (private)
- Token bucket per bot di Redis (`ratelimit:bot:{bot_id}`)
- Token bucket per chat (`ratelimit:chat:{bot_id}:{chat_id}`)
- Kalo limit kena, retry via asynq dengan exponential backoff (max 5 attempts)

## 7. Web Service Design

### 7.1 Routing

```
app/
├── (marketing)/                 # landing
│   └── page.tsx
├── (auth)/                      # login, register, verify
├── (dashboard)/[merchantSlug]/
│   ├── overview/
│   ├── products/
│   ├── orders/
│   ├── customers/
│   ├── vouchers/
│   ├── balance/
│   ├── settings/{bot,team,billing}/
│   └── reports/
├── (mini-app)/m/[merchantSlug]/
│   ├── page.tsx                 # katalog
│   ├── product/[slug]/
│   ├── cart/
│   └── orders/
├── (admin)/admin/
│   ├── merchants/
│   ├── plans/
│   ├── platform-revenue/
│   └── disputes/
└── api/
    ├── auth/                    # NextAuth
    ├── v1/                      # public API (mini app)
    │   ├── catalog/
    │   ├── orders/
    │   └── balance/
    ├── internal/                # service-to-service
    │   ├── deliver/
    │   └── webhook-pg/
    └── webhooks/telegram-login/
```

### 7.2 Auth

- **NextAuth.js v5** dengan providers:
  - Credentials (email + password, bcrypt)
  - Custom Telegram provider (verify HMAC dari Telegram Login Widget)
- Session: JWT dengan blacklist di Redis on logout
- Multi-merchant: active merchant disimpan di session, switcher di dashboard
  header
- API `/api/internal/*`: middleware verify `X-Service-Token` shared dengan
  bot-service (env var)
- Mini App: validate `initData` HMAC di tiap request → derive `customer_id`,
  set short-lived JWT

### 7.3 RBAC

| Role | Permissions |
|---|---|
| owner | Semua, termasuk billing, transfer ownership, delete merchant |
| admin | Semua kecuali billing & destructive merchant actions |
| finance | Orders read, balance, payout, invoices, reports |
| support | Orders, customers, complaints (limited write) |

Implementasi: matrix di `lib/permissions.ts`, middleware check di route group.

### 7.4 Payment Integration

**Provider**: Tripay (default). Adapter pattern di `lib/payment/` supaya bisa
tambah Midtrans/Xendit nanti tanpa rewrite.

**Customer order flow:**
1. Mini app `POST /api/v1/orders` → create `pending_payment`
2. Server call Tripay create-transaction API → return payment URL/QRIS
3. Mini app render payment options
4. Customer bayar → Tripay POST callback ke `/api/internal/webhook-pg`
5. Server verify signature → `orders.status = paid` → enqueue `delivery` job
6. Bot service deliver → reply customer
7. Update `merchant_balances.pending_idr`, `platform_invoices` (transaction
   fee)

**Subscription billing flow:**
- Cron harian: cek subscription expiring dalam 7 hari → generate
  `platform_invoices` (type=subscription)
- Email + bot notif merchant
- Pembayaran via Tripay invoice link

**Payout flow:**
- Merchant request payout di dashboard
- `merchant_payouts.status = requested`, `merchant_balances.available_idr` di-debit
- Platform admin approve (auto-approve di tier pro+ di phase 2)
- Tripay disbursement API → `processing` → callback → `paid`
- Reject → balance dikembalikan

## 8. Key User Flows

### 8.1 Merchant Onboarding (target <10 menit)
1. Sign up dashboard (email verify atau Telegram OAuth)
2. Create merchant → input nama toko + slug
3. Trial 14 hari aktif
4. Wizard setup bot:
   - Tutorial bikin bot di @BotFather (link + screenshot)
   - Paste bot token → server validate `getMe()` → encrypt + simpan
   - Server `setWebhook` ke `https://bot.lapakgram.id/webhook/{secret}` dengan
     `secret_token`
   - Test: chat `/start` ke bot, verify reply "Selamat datang di {nama}"
5. Wizard produk pertama: pilih type, input minimal 1 produk + 1 stok
6. Set bot menu: `t.me/{botUsername}/shop` (Mini App URL) via Telegram API
7. Bot ready jualan

### 8.2 Customer Beli Akun Premium
1. Customer chat bot, klik "🛒 Buka Toko" → Mini App launch
2. Browse kategori → produk → "Beli Sekarang"
3. Login auto via initData HMAC verify
4. Pilih bayar: **Saldo** (kalo cukup) atau **PG** (QRIS, VA, e-wallet)
5. Bayar → webhook PG → order paid → delivery job:
   - `SELECT FOR UPDATE SKIP LOCKED` ambil 1 stok available
   - Format pesan dari `delivery_template` (substitusi `{email}`, `{password}`,
     dll)
   - Bot send pesan ke customer
   - Stok status=sold, order delivered, set `warranty_until = now() +
     warranty_days`
6. Mini app + bot kasih notif "✅ Pesanan dikirim"
7. Cron harian: pending_idr → available_idr (hold period 1 hari)

### 8.3 Komplain & Replace (auto mode)
1. Customer di bot `/orders` atau mini app history
2. Pilih order dalam masa garansi → "Komplain"
3. Pilih alasan template ("Tidak bisa login", "Sudah di-kick", "Lainnya: ___")
4. Kalo `warranty_mode = auto`:
   - Job `replace` cek stok available
   - Ada: assign stok baru, kirim, `complaints.status = auto_resolved`
   - Habis: `pending_review`, notif merchant
5. Kalo `manual`: langsung `pending_review`, merchant approve di dashboard

### 8.4 Top Up Saldo Customer
1. Bot atau mini app klik "Top Up"
2. Input nominal atau pilih preset (50k/100k/200k/500k)
3. Buat `balance_topups` + Tripay transaction
4. Bayar → webhook → atomically:
   - `balance_topups.status = paid`
   - `customers.balance_idr += amount`
   - Insert `balance_transactions` (type=topup)
5. Bot notif "✅ Saldo +Rp{amount}, total Rp{balance}"

### 8.5 Merchant Withdrawal
1. Dashboard → Balance → "Tarik Saldo"
2. Input nominal + pilih bank account (saved/baru)
3. Submit → `merchant_payouts.status=requested`, available_idr di-debit
4. Platform admin review (atau auto-approve tier pro+)
5. Tripay disbursement → callback → paid / rejected (dengan rollback balance)

## 9. Cross-Cutting Concerns

### 9.1 Observability
- **Logs**: structured JSON (`slog` Go, `pino` Next), aggregator Grafana Loki
- **Metrics**: Prometheus + Grafana. Track webhook latency, delivery success
  rate, PG callback rate, RLS query distribution
- **Alerts**: internal Telegram bot kasih alert ke owner platform pada error
  rate > threshold

### 9.2 Error Handling
- **Idempotency keys** wajib di:
  - PG webhook (`pg_reference`)
  - Delivery job (`order_id`)
  - Replace job (`complaint_id`)
  - Balance transaction (`reference_id` + `type`)
  - Telegram update (`update_id`)
- **Saga lite**: order paid → delivery → kalo fail 3x, mark `failed`, refund
  saldo (jika balance) atau alert manual refund
- **No silent failures**: tiap exception worker → log + alert

### 9.3 Testing Strategy
- **Unit**: pricing, balance calc, voucher rules, RLS policy enforcement
- **Integration**: API + DB (testcontainers Postgres + Redis)
- **E2E**: Playwright dashboard core flow (login → create product → view order)
- **Bot**: simulated Telegram webhook payload, assert reply structure
- **TDD wajib** untuk modul finance: balance, order, payout, transaction fee
- **RLS test suite**: fixture multi-tenant, assert no cross-tenant access

### 9.4 Security
- Encryption at rest: bot tokens, bank account numbers
- Rate limit per IP di auth endpoints (Redis token bucket)
- Security headers: CSP, HSTS, X-Frame-Options
- Mini App initData HMAC verification wajib di tiap mini-app API request
- Secrets: env-based, dengan opsi Doppler/Infisical
- RLS test suite di CI

### 9.5 Deployment

**Coolify on Hetzner VPS:**
- 3 service: `web` (Next.js), `bot` (Go server mode), `worker` (Go worker mode)
- Built-in service: Postgres, Redis, MinIO
- CI: GitHub Actions → build Docker images → push GHCR → Coolify auto-deploy
  on tag

**Monorepo structure:**
```
lapakgram/
├── apps/
│   ├── web/                  # Next.js
│   └── bot/                  # Go
├── packages/
│   ├── db/                   # Drizzle schema + migrations + sqlc queries
│   ├── shared/               # TS types, constants
│   └── ui/                   # Reusable React components
├── docker-compose.yml        # local dev
├── docker-compose.prod.yml
├── docs/superpowers/specs/
└── turbo.json
```

Tooling: pnpm workspaces, Turborepo (build cache).

## 10. Open Questions / Risks

- **Tripay rate limits / disbursement quota**: perlu cek docs sebelum
  finalisasi adapter. Backup plan: Midtrans atau Xendit kalo Tripay limit
  kekecilan.
- **Telegram Bot API rate limit di skala**: 30 msg/sec/bot keras. Buat broadcast
  (phase 3) wajib kuasi-async dengan progress tracker.
- **Compliance merchant of record**: jangka panjang (volume ratusan juta IDR
  bulanan), wajib partner ke aggregator yang punya izin BI atau apply izin
  PJP/PTP sendiri. Tidak diblok di MVP, tapi dokumentasikan as known risk.
- **RLS performance pada query analytics**: query agregat (mis. revenue per
  hari per merchant) bisa slow karena RLS overhead. Mitigation: materialized
  view atau opt-out RLS untuk read replica analitik (out of scope MVP).
- **Bot token rotation**: kalo merchant regenerate token di BotFather, kita
  butuh UI replace token + revoke old webhook. In-MVP, manual flow di settings.

## 11. Out of Scope (MVP)

Reservasi schema sudah ditaruh untuk fitur ini supaya tidak butuh migrasi
besar nanti, tapi UI & business logic tidak dibangun di MVP:

- Multi-level reseller / harga tier (phase 2)
- Review & rating produk (phase 2)
- Affiliate / referral program (phase 3)
- Broadcast & retention messaging (phase 3)
- PPOB / H2H supplier integration
- Custom service / jasa workflow (manual fulfillment)
- Mobile native app
- White-label custom domain
- Multi-currency
