# Lapakgram

Multi-tenant SaaS untuk jualan produk digital di Telegram. Tiap merchant
dapet bot Telegram sendiri, mini app e-commerce, dan dashboard web.

## Tech stack

- **Web (`apps/web`)** — Next.js 15, TypeScript, Tailwind, NextAuth (Plan 2)
- **Bot (`apps/bot`)** — Go, gotgbot, asynq (Plan 3)
- **DB (`packages/db`)** — Drizzle ORM, Postgres 16, RLS multi-tenancy
- **Infra dev** — Docker Compose (Postgres + Redis + MinIO)

## Prerequisites

- Node 20+ (`nvm use`)
- pnpm 9+ (`npm install -g pnpm@9`)
- Docker Desktop / Docker Engine
- Go 1.23+ (mulai Plan 3)

## Quick start

```bash
# 1. Install deps
pnpm install

# 2. Copy env (Windows PowerShell: `Copy-Item .env.example .env`)
cp .env.example .env

# 3. Start dev infra (Postgres on 5434, Redis on 6380, MinIO on 9000/9001)
pnpm dev:up

# 4. Apply migrations
pnpm db:migrate

# 5. Run web dev server
pnpm --filter @lapakgram/web dev
# → http://localhost:3000

# 6. Run all tests (requires Docker for testcontainers)
pnpm test
```

Stop infra: `pnpm dev:down`. Reset infra (delete volumes): `pnpm dev:reset`.

> **Why non-default ports?** Lapakgram coexists with sibling projects (Lapakflow,
> native Postgres) that already use 5432 and 6379 on dev machines. Container-side
> ports remain standard; only the host bindings shift to 5434 and 6380.

## Repository layout

```
lapakgram/
├── apps/
│   ├── web/                  # Next.js dashboard + mini app + API
│   └── bot/                  # Go bot service (Plan 3)
├── packages/
│   └── db/                   # Drizzle schema + migrations + RLS helpers
├── docker-compose.yml        # dev infra
├── docs/superpowers/
│   ├── specs/                # design docs
│   └── plans/                # implementation plans (this folder)
└── turbo.json
```

## Multi-tenancy & RLS

Tabel "tenant data" punya kolom `merchant_id`. Setiap query dari aplikasi
**harus** dijalankan di dalam transaction dengan `app.current_merchant_id` set
ke UUID merchant yang aktif. Postgres RLS (`tenant_isolation` policy) yang
ngeblok cross-tenant access.

Contoh penggunaan dari TypeScript:

```ts
import { createDb, setTenantContext } from "@lapakgram/db";

const db = createDb(process.env.DATABASE_URL!);

await db.transaction(async (tx) => {
  await setTenantContext(tx, currentMerchantId);
  return tx.select().from(products);
});
```

`setTenantContext` accepts only a transaction handle (not the top-level `db`)
because `set_config(..., true)` is transaction-local — calling it on a pooled
connection outside a transaction silently no-ops, which would bypass RLS.

Test isolasi RLS hidup di `packages/db/tests/rls.test.ts`. Kalau nambahin
tabel tenant baru, tambahin nama-nya ke:

- `packages/db/src/rls.ts` (`TENANT_TABLES`)
- Tulis migration baru via `pnpm --filter @lapakgram/db exec drizzle-kit generate --custom --name rls_<table>` lalu paste `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation ON ...` (mirror policy SQL di `0002_rls_policies.sql`)
- Test fixture di `packages/db/tests/rls.test.ts` — extend coverage to the new table

Note: the RLS test pool connects as a non-superuser `app_user` role (created in
`packages/db/tests/setup.ts`) because Postgres superusers bypass RLS even with
`FORCE ROW LEVEL SECURITY`. Jangan ubah ini tanpa verify ulang invariant check
di setup.ts.

## Environment variables

Lihat `.env.example`. Yang wajib di-set sebelum run:

| Var                      | Deskripsi                               |
| ------------------------ | --------------------------------------- |
| `DATABASE_URL`           | Postgres URL                            |
| `REDIS_URL`              | Redis URL                               |
| `MASTER_ENCRYPTION_KEY`  | 32-byte base64, untuk encrypt bot token |
| `INTERNAL_SERVICE_TOKEN` | Shared token web ↔ bot                  |
| `NEXTAUTH_SECRET`        | NextAuth signing key                    |

Generate fresh encryption key:

```bash
# macOS / Linux:
openssl rand -base64 32
# Windows PowerShell:
[Convert]::ToBase64String((New-Object byte[] 32 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Useful scripts

| Command            | What it does                                |
| ------------------ | ------------------------------------------- |
| `pnpm dev:up`      | Start Postgres, Redis, MinIO                |
| `pnpm dev:down`    | Stop services                               |
| `pnpm dev:reset`   | Stop + delete volumes                       |
| `pnpm db:generate` | Generate Drizzle migration from schema diff |
| `pnpm db:migrate`  | Apply pending migrations                    |
| `pnpm db:studio`   | Open Drizzle Studio (DB GUI)                |
| `pnpm test`        | Run all tests                               |
| `pnpm typecheck`   | TS typecheck across workspaces              |
| `pnpm lint`        | Lint                                        |
| `pnpm format`      | Prettier write                              |

## Plans & specs

- Design spec: `docs/superpowers/specs/2026-05-16-lapakgram-design.md`
- Implementation plans: `docs/superpowers/plans/`
