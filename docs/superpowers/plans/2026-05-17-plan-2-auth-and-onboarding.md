# Plan 2 — Auth & Merchant Onboarding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new visitor can sign up, verify their email or login via Telegram, create a merchant, wire their own Telegram bot, invite teammates, and reach a "merchant active, bot online" state — all without writing any product or order code.

**Architecture:** All work lives in `apps/web` (Next.js 15) plus a few schema additions in `packages/db`. Auth via NextAuth v5 (`auth.js`) with custom Credentials and Telegram providers. Bot wiring uses a stub Next.js webhook route at `/api/webhooks/telegram/[secret]` that Plan 3 later replaces with the Go bot service (URL stays stable, only routing target changes). Multi-admin via the existing `merchant_members` table + middleware-based RBAC.

**Tech Stack:** Next.js 15, NextAuth v5 (Auth.js), bcrypt, jose (JWT for invite tokens), Drizzle ORM, Vitest + Playwright. No new infra services; uses Postgres (already migrated) and email-via-console-log in dev.

**Outcome:** After this plan, a fresh dev can run the app, register a user, verify their email (via dev console link), create a merchant, paste a Bot Father token and see "Bot online ✓", invite a teammate, sign in as the teammate, accept the invite, and chat `/start` to the bot to get a stub welcome reply. Plan 3 will swap the stub for real catalog/order logic.

---

## File Structure

This plan modifies/adds files in three areas:

### `apps/web/` — most of the work

```
apps/web/
├── auth.config.ts                      # NextAuth shared config
├── auth.ts                             # NextAuth main + handlers
├── middleware.ts                       # Auth + RBAC route guards
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx              # email + Telegram OAuth login form
│   │   ├── register/page.tsx           # email signup form
│   │   ├── verify-email/page.tsx       # consume token, mark verified
│   │   ├── invite/[token]/page.tsx     # accept-invite landing
│   │   └── layout.tsx                  # public layout
│   ├── (dashboard)/
│   │   ├── layout.tsx                  # auth required, render shell
│   │   ├── new-merchant/page.tsx       # create merchant flow
│   │   ├── [merchantSlug]/
│   │   │   ├── layout.tsx              # merchant context, RBAC check
│   │   │   ├── page.tsx                # overview placeholder
│   │   │   ├── settings/
│   │   │   │   ├── bot/page.tsx        # bot wizard
│   │   │   │   └── team/page.tsx       # member list + invite form
│   │   └── _components/
│   │       └── merchant-switcher.tsx
│   ├── (admin)/
│   │   └── admin/
│   │       └── merchants/page.tsx      # platform admin merchant list
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts # NextAuth handler
│   │   └── webhooks/telegram/[secret]/route.ts # bot webhook stub (Plan 3 replaces)
├── lib/
│   ├── auth/
│   │   ├── password.ts                 # bcrypt wrapper (TDD)
│   │   ├── telegram-oauth.ts           # HMAC verifier for Telegram Login Widget (TDD)
│   │   ├── telegram-mini-app.ts        # HMAC verifier for Mini App initData (deferred to Plan 3, stub here)
│   │   └── invite-token.ts             # signed JWT for invites (TDD)
│   ├── permissions.ts                  # RBAC matrix + helpers (TDD)
│   ├── telegram/
│   │   ├── client.ts                   # tiny REST client for getMe / setWebhook
│   │   └── reply.ts                    # tiny sendMessage helper for stub
│   ├── email/
│   │   └── send.ts                     # dev: console.log; prod: provider plug-in (deferred)
│   └── server-actions/
│       ├── auth.ts                     # register, login (server actions for forms)
│       ├── merchant.ts                 # createMerchant, switchMerchant
│       ├── bot.ts                      # validateAndStoreToken, setWebhookOnBot
│       └── members.ts                  # invite, acceptInvite, changeRole, removeMember
├── tests/
│   ├── lib/
│   │   ├── password.test.ts
│   │   ├── telegram-oauth.test.ts
│   │   ├── invite-token.test.ts
│   │   └── permissions.test.ts
│   └── server-actions/
│       ├── auth.test.ts
│       ├── merchant.test.ts
│       └── bot.test.ts
└── e2e/
    └── onboarding.spec.ts              # Playwright end-to-end
```

### `packages/db/` — small schema additions

```
packages/db/src/schema/
├── platform.ts                         # add: email_verifications, merchant_invites
└── (no new files; existing tables get one or two columns)
```

Two new tables:

- `email_verifications`: id, user_id, token_hash, expires_at, consumed_at
- `merchant_invites`: id, merchant_id, email, telegram_id (nullable), role, token_hash, invited_by, expires_at, accepted_at, accepted_by_user_id

### Migrations

- `0004_auth_tables.sql` — adds the two tables above plus indexes (drizzle-generated)

---

## Task 1: Add email_verifications and merchant_invites tables

**Files:**

- Modify: `packages/db/src/schema/platform.ts`
- Create: `packages/db/migrations/0004_auth_tables.sql` (drizzle-generated)

- [ ] **Step 1: Add table definitions to `packages/db/src/schema/platform.ts`**

Append (before the relations block at the bottom):

```ts
// ============================================================
// email_verifications
// ============================================================
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("email_verifications_user_idx").on(t.userId),
    tokenHashIdx: uniqueIndex("email_verifications_token_hash_idx").on(t.tokenHash),
  }),
);

// ============================================================
// merchant_invites
// ============================================================
export const merchantInvites = pgTable(
  "merchant_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    email: text("email"),
    telegramId: bigint("telegram_id", { mode: "bigint" }),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantIdx: index("merchant_invites_merchant_idx").on(t.merchantId),
    tokenHashIdx: uniqueIndex("merchant_invites_token_hash_idx").on(t.tokenHash),
    emailIdx: index("merchant_invites_email_idx").on(t.email),
  }),
);
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @lapakgram/db typecheck`
Expected: No errors.

- [ ] **Step 3: Generate migration**

Run:

```
$env:DATABASE_URL = "postgres://lapakgram:lapakgram_dev@localhost:5434/lapakgram"
pnpm db:generate
```

Expected: New file `packages/db/migrations/0004_<name>.sql` containing CREATE TABLE for both tables and the indexes.

- [ ] **Step 4: Apply migration**

Run: `pnpm db:migrate`

Verify:

```
docker exec lapakgram-postgres psql -U lapakgram -d lapakgram -c "\dt"
```

Expected: 22 tables in public schema (was 20, +2).

- [ ] **Step 5: Commit**

```
git add packages/db/src/schema/platform.ts packages/db/migrations/
git commit -m "feat(db): add email_verifications and merchant_invites tables"
```

---

## Task 2: Bcrypt password helper (TDD)

**Files:**

- Create: `apps/web/lib/auth/password.ts`
- Create: `apps/web/tests/lib/password.test.ts`

- [ ] **Step 1: Add bcrypt dependency**

Run: `pnpm --filter @lapakgram/web add bcrypt && pnpm --filter @lapakgram/web add -D @types/bcrypt`

- [ ] **Step 2: Write failing tests**

Create `apps/web/tests/lib/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../lib/auth/password.js";

describe("password", () => {
  it("hashes a password and verifies it back", async () => {
    const plain = "correct horse battery staple";
    const hash = await hashPassword(plain);
    expect(hash).not.toBe(plain);
    expect(hash.length).toBeGreaterThan(50);
    expect(await verifyPassword(plain, hash)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", hash)).toBe(false);
  });

  it("produces different hash for same plaintext (random salt)", async () => {
    const a = await hashPassword("samepass");
    const b = await hashPassword("samepass");
    expect(a).not.toBe(b);
    expect(await verifyPassword("samepass", a)).toBe(true);
    expect(await verifyPassword("samepass", b)).toBe(true);
  });

  it("rejects empty password at hash time", async () => {
    await expect(hashPassword("")).rejects.toThrow(/non-empty/i);
  });

  it("verifyPassword returns false for malformed hash", async () => {
    expect(await verifyPassword("anything", "not-a-bcrypt-hash")).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests, verify they FAIL**

Run: `pnpm --filter @lapakgram/web test tests/lib/password.test.ts`
Expected: FAIL with import error (file not yet created).

- [ ] **Step 4: Implement `apps/web/lib/auth/password.ts`**

```ts
import bcrypt from "bcrypt";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("password must be a non-empty string");
  }
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run tests, verify they PASS**

Run: `pnpm --filter @lapakgram/web test tests/lib/password.test.ts`
Expected: 5/5 passing.

- [ ] **Step 6: Commit**

```
git add apps/web/lib/auth/password.ts apps/web/tests/lib/password.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add bcrypt password helper with TDD coverage"
```

---

## Task 3: Telegram OAuth HMAC verifier (TDD)

**Files:**

- Create: `apps/web/lib/auth/telegram-oauth.ts`
- Create: `apps/web/tests/lib/telegram-oauth.test.ts`

The Telegram Login Widget gives us a payload like:

```
{ id, first_name, last_name?, username?, photo_url?, auth_date, hash }
```

where `hash` is HMAC-SHA-256 of all other fields (alphabetically sorted as `key=value` lines joined by `\n`), keyed by SHA-256 of the bot token.

Reference: https://core.telegram.org/widgets/login#checking-authorization

- [ ] **Step 1: Write failing tests**

Create `apps/web/tests/lib/telegram-oauth.test.ts`:

```ts
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramAuth } from "../../lib/auth/telegram-oauth.js";

const BOT_TOKEN = "1234567890:AAH-FAKE-TOKEN";

function signAuth(payload: Record<string, string | number>): string {
  const lines = Object.entries(payload)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  return createHmac("sha256", secretKey).update(lines).digest("hex");
}

describe("verifyTelegramAuth", () => {
  it("accepts a valid payload", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: 12345,
      first_name: "Alice",
      auth_date: now,
    };
    const hash = signAuth(payload);
    const result = verifyTelegramAuth({ ...payload, hash }, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(12345n);
  });

  it("rejects tampered payload (wrong hash)", () => {
    const payload = {
      id: 12345,
      first_name: "Alice",
      auth_date: Math.floor(Date.now() / 1000),
      hash: "0".repeat(64),
    };
    const result = verifyTelegramAuth(payload, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it("rejects payload signed with different bot token", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { id: 12345, first_name: "Alice", auth_date: now };
    const hash = signAuth(payload);
    const result = verifyTelegramAuth({ ...payload, hash }, "999:DIFFERENT");
    expect(result.ok).toBe(false);
  });

  it("rejects stale auth_date (>24h old)", () => {
    const old = Math.floor(Date.now() / 1000) - 25 * 3600;
    const payload = { id: 1, first_name: "A", auth_date: old };
    const hash = signAuth(payload);
    const result = verifyTelegramAuth({ ...payload, hash }, BOT_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale|expired/i);
  });

  it("returns parsed user fields including username when present", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: 99,
      first_name: "Bob",
      last_name: "Smith",
      username: "bobby",
      auth_date: now,
    };
    const hash = signAuth(payload);
    const result = verifyTelegramAuth({ ...payload, hash }, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(99n);
      expect(result.user.firstName).toBe("Bob");
      expect(result.user.lastName).toBe("Smith");
      expect(result.user.username).toBe("bobby");
    }
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `pnpm --filter @lapakgram/web test tests/lib/telegram-oauth.test.ts`
Expected: FAIL with import error.

- [ ] **Step 3: Implement `apps/web/lib/auth/telegram-oauth.ts`**

```ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramAuthPayload {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
  [key: string]: unknown;
}

export interface TelegramUser {
  id: bigint;
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export type VerifyResult = { ok: true; user: TelegramUser } | { ok: false; reason: string };

const MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyTelegramAuth(payload: TelegramAuthPayload, botToken: string): VerifyResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "missing payload" };
  }
  if (typeof payload.hash !== "string" || payload.hash.length !== 64) {
    return { ok: false, reason: "missing or malformed hash" };
  }

  // Build data-check string: all fields except `hash`, sorted, joined by \n.
  const lines = Object.entries(payload)
    .filter(([k]) => k !== "hash")
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(lines).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(payload.hash, "hex");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "hash mismatch" };
  }

  const authDate =
    typeof payload.auth_date === "number" ? payload.auth_date : parseInt(payload.auth_date, 10);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "missing auth_date" };
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS) {
    return { ok: false, reason: "auth_date stale (expired)" };
  }
  if (ageSeconds < -60) {
    return { ok: false, reason: "auth_date in future" };
  }

  const idVal = typeof payload.id === "number" ? payload.id : parseInt(String(payload.id), 10);
  if (!Number.isFinite(idVal)) {
    return { ok: false, reason: "missing id" };
  }

  return {
    ok: true,
    user: {
      id: BigInt(idVal),
      firstName: typeof payload.first_name === "string" ? payload.first_name : undefined,
      lastName: typeof payload.last_name === "string" ? payload.last_name : undefined,
      username: typeof payload.username === "string" ? payload.username : undefined,
      photoUrl: typeof payload.photo_url === "string" ? payload.photo_url : undefined,
    },
  };
}
```

- [ ] **Step 4: Run tests, verify they PASS**

Run: `pnpm --filter @lapakgram/web test tests/lib/telegram-oauth.test.ts`
Expected: 5/5 passing.

- [ ] **Step 5: Commit**

```
git add apps/web/lib/auth/telegram-oauth.ts apps/web/tests/lib/telegram-oauth.test.ts
git commit -m "feat(web): add Telegram Login Widget HMAC verifier"
```

---

## Task 4: Invite token util (TDD)

**Files:**

- Create: `apps/web/lib/auth/invite-token.ts`
- Create: `apps/web/tests/lib/invite-token.test.ts`

We use a signed JWT for invites so the email/Telegram link contains a self-verifying token. The DB stores a SHA-256 hash of the JWT for lookup; the JWT itself never appears in the DB.

- [ ] **Step 1: Add jose dependency**

Run: `pnpm --filter @lapakgram/web add jose`

- [ ] **Step 2: Write failing tests**

Create `apps/web/tests/lib/invite-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createInviteToken,
  hashInviteToken,
  verifyInviteToken,
} from "../../lib/auth/invite-token.js";

const SIGNING_SECRET = Buffer.alloc(32, 7).toString("base64");

describe("invite token", () => {
  it("issues and verifies a token round-trip", async () => {
    const token = await createInviteToken(
      {
        inviteId: "11111111-1111-1111-1111-111111111111",
        merchantId: "22222222-2222-2222-2222-222222222222",
      },
      SIGNING_SECRET,
      { ttlSeconds: 3600 },
    );
    const result = await verifyInviteToken(token, SIGNING_SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.inviteId).toBe("11111111-1111-1111-1111-111111111111");
      expect(result.payload.merchantId).toBe("22222222-2222-2222-2222-222222222222");
    }
  });

  it("rejects expired token", async () => {
    const token = await createInviteToken({ inviteId: "abc", merchantId: "xyz" }, SIGNING_SECRET, {
      ttlSeconds: -10,
    });
    const result = await verifyInviteToken(token, SIGNING_SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects token signed with different secret", async () => {
    const token = await createInviteToken({ inviteId: "abc", merchantId: "xyz" }, SIGNING_SECRET, {
      ttlSeconds: 3600,
    });
    const otherSecret = Buffer.alloc(32, 9).toString("base64");
    const result = await verifyInviteToken(token, otherSecret);
    expect(result.ok).toBe(false);
  });

  it("rejects malformed token", async () => {
    const result = await verifyInviteToken("not.a.jwt", SIGNING_SECRET);
    expect(result.ok).toBe(false);
  });

  it("hashInviteToken is deterministic and 64 hex chars", () => {
    const a = hashInviteToken("some-token");
    const b = hashInviteToken("some-token");
    const c = hashInviteToken("other-token");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 3: Run tests, verify they FAIL**

Run: `pnpm --filter @lapakgram/web test tests/lib/invite-token.test.ts`
Expected: FAIL with import error.

- [ ] **Step 4: Implement `apps/web/lib/auth/invite-token.ts`**

```ts
import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export interface InvitePayload {
  inviteId: string;
  merchantId: string;
}

export type VerifyInviteResult =
  | { ok: true; payload: InvitePayload }
  | { ok: false; reason: string };

function getKey(secret: string): Uint8Array {
  const buf = Buffer.from(secret, "base64");
  if (buf.length < 32) {
    throw new Error("invite signing secret must be at least 32 bytes (base64-encoded)");
  }
  return buf;
}

export async function createInviteToken(
  payload: InvitePayload,
  secret: string,
  options: { ttlSeconds: number },
): Promise<string> {
  const key = getKey(secret);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ inviteId: payload.inviteId, merchantId: payload.merchantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + options.ttlSeconds)
    .setIssuer("lapakgram")
    .setAudience("lapakgram-invite")
    .sign(key);
}

export async function verifyInviteToken(
  token: string,
  secret: string,
): Promise<VerifyInviteResult> {
  try {
    const key = getKey(secret);
    const { payload } = await jwtVerify(token, key, {
      issuer: "lapakgram",
      audience: "lapakgram-invite",
    });
    if (typeof payload.inviteId !== "string" || typeof payload.merchantId !== "string") {
      return { ok: false, reason: "missing claims" };
    }
    return { ok: true, payload: { inviteId: payload.inviteId, merchantId: payload.merchantId } };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "verify failed" };
  }
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 5: Run tests, verify they PASS**

Run: `pnpm --filter @lapakgram/web test tests/lib/invite-token.test.ts`
Expected: 5/5 passing.

- [ ] **Step 6: Commit**

```
git add apps/web/lib/auth/invite-token.ts apps/web/tests/lib/invite-token.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add invite token util (signed JWT + sha256 hash)"
```

---

## Task 5: RBAC permissions matrix (TDD)

**Files:**

- Create: `apps/web/lib/permissions.ts`
- Create: `apps/web/tests/lib/permissions.test.ts`

Roles per spec: `owner`, `admin`, `finance`, `support`. We define permission slugs and a matrix mapping role → set of allowed permissions.

- [ ] **Step 1: Write failing tests**

Create `apps/web/tests/lib/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "../../lib/permissions.js";

const ALL_ROLES: Role[] = ["owner", "admin", "finance", "support"];

describe("permissions matrix", () => {
  it("owner can do everything", () => {
    const allPerms: Permission[] = [
      "merchant:delete",
      "merchant:billing:read",
      "merchant:billing:write",
      "members:invite",
      "members:remove",
      "members:change-role",
      "products:read",
      "products:write",
      "orders:read",
      "orders:refund",
      "balance:read",
      "balance:withdraw",
      "complaints:handle",
    ];
    for (const p of allPerms) expect(can("owner", p)).toBe(true);
  });

  it("admin cannot delete merchant or change billing", () => {
    expect(can("admin", "merchant:delete")).toBe(false);
    expect(can("admin", "merchant:billing:write")).toBe(false);
    expect(can("admin", "members:invite")).toBe(true);
    expect(can("admin", "products:write")).toBe(true);
  });

  it("finance can read orders and withdraw, cannot edit products", () => {
    expect(can("finance", "orders:read")).toBe(true);
    expect(can("finance", "balance:withdraw")).toBe(true);
    expect(can("finance", "products:write")).toBe(false);
    expect(can("finance", "members:invite")).toBe(false);
  });

  it("support can handle complaints and read orders, cannot withdraw", () => {
    expect(can("support", "complaints:handle")).toBe(true);
    expect(can("support", "orders:read")).toBe(true);
    expect(can("support", "balance:withdraw")).toBe(false);
    expect(can("support", "merchant:delete")).toBe(false);
  });

  it("rejects unknown role", () => {
    // @ts-expect-error testing runtime guard
    expect(can("hacker", "products:read")).toBe(false);
  });

  it("rejects unknown permission", () => {
    // @ts-expect-error testing runtime guard
    expect(can("owner", "nonexistent:perm")).toBe(false);
  });

  it("every role rejects unknown permission", () => {
    for (const role of ALL_ROLES) {
      // @ts-expect-error
      expect(can(role, "fake:perm")).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `pnpm --filter @lapakgram/web test tests/lib/permissions.test.ts`
Expected: FAIL with import error.

- [ ] **Step 3: Implement `apps/web/lib/permissions.ts`**

```ts
export const ROLES = ["owner", "admin", "finance", "support"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "merchant:delete",
  "merchant:billing:read",
  "merchant:billing:write",
  "members:invite",
  "members:remove",
  "members:change-role",
  "products:read",
  "products:write",
  "orders:read",
  "orders:refund",
  "balance:read",
  "balance:withdraw",
  "complaints:handle",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>(PERMISSIONS),
  admin: new Set<Permission>([
    "merchant:billing:read",
    "members:invite",
    "members:remove",
    "members:change-role",
    "products:read",
    "products:write",
    "orders:read",
    "orders:refund",
    "balance:read",
    "complaints:handle",
  ]),
  finance: new Set<Permission>([
    "merchant:billing:read",
    "merchant:billing:write",
    "orders:read",
    "balance:read",
    "balance:withdraw",
  ]),
  support: new Set<Permission>(["products:read", "orders:read", "complaints:handle"]),
};

export function can(role: Role, perm: Permission): boolean {
  const set = ROLE_PERMS[role];
  if (!set) return false;
  return set.has(perm);
}

export function permsForRole(role: Role): Permission[] {
  const set = ROLE_PERMS[role];
  return set ? [...set] : [];
}
```

- [ ] **Step 4: Run tests, verify they PASS**

Run: `pnpm --filter @lapakgram/web test tests/lib/permissions.test.ts`
Expected: 7/7 passing.

- [ ] **Step 5: Commit**

```
git add apps/web/lib/permissions.ts apps/web/tests/lib/permissions.test.ts
git commit -m "feat(web): add RBAC permissions matrix with role/permission types"
```

---

## Task 6: NextAuth wiring with Credentials + Telegram providers

**Files:**

- Create: `apps/web/auth.config.ts`
- Create: `apps/web/auth.ts`
- Create: `apps/web/app/api/auth/[...nextauth]/route.ts`
- Modify: `.env.example` (add NEXTAUTH_SECRET, AUTH_URL, INVITE_SIGNING_SECRET, TELEGRAM_LOGIN_BOT_TOKEN, TELEGRAM_LOGIN_BOT_USERNAME)

This task wires NextAuth without UI yet. The login form (Task 7) will call into these.

- [ ] **Step 1: Add NextAuth deps**

Run: `pnpm --filter @lapakgram/web add next-auth@beta`

(NextAuth v5 is in beta but stable enough for production. Keep an eye on the beta tag.)

- [ ] **Step 2: Update `.env.example`**

Modify the existing `.env.example` to add (after the existing `NEXTAUTH_SECRET=` line):

```
# Auth
NEXTAUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
INVITE_SIGNING_SECRET=ZGV2X29ubHlfaW52aXRlX3NpZ25pbmdfa2V5XzMyXyE=
TELEGRAM_LOGIN_BOT_USERNAME=
TELEGRAM_LOGIN_BOT_TOKEN=
```

`INVITE_SIGNING_SECRET` decodes to a 32-byte placeholder. Document in the comment that production must regen.

The existing `NEXTAUTH_SECRET=dev_nextauth_secret_change_me` stays. Update its comment to clarify it should be 32+ bytes random in prod.

- [ ] **Step 3: Create `apps/web/auth.config.ts`**

```ts
import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe config. Loaded by middleware. Provider list goes in `auth.ts`
 * because some providers (Credentials with bcrypt) require Node runtime.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const path = request.nextUrl.pathname;
      const isAuthPage =
        path.startsWith("/login") ||
        path.startsWith("/register") ||
        path.startsWith("/verify-email") ||
        path.startsWith("/invite/");

      // Public marketing root for now.
      if (path === "/") return true;
      if (isAuthPage) return true;

      // Everything under (dashboard) and (admin) requires auth.
      return isLoggedIn;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.email = user.email ?? null;
        token.telegramId = (user as { telegramId?: string }).telegramId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.email = (token.email as string | null) ?? undefined;
      (session.user as { telegramId?: string | null }).telegramId =
        (token.telegramId as string | null) ?? null;
      return session;
    },
  },
  session: { strategy: "jwt" },
  providers: [], // populated in auth.ts
};
```

- [ ] **Step 4: Create `apps/web/auth.ts`**

```ts
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { createDb, schema } from "@lapakgram/db";
import { verifyPassword } from "./lib/auth/password.js";
import { verifyTelegramAuth } from "./lib/auth/telegram-oauth.js";
import { authConfig } from "./auth.config.js";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      telegramId: string | null;
    } & DefaultSession["user"];
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required");

const db = createDb(databaseUrl);
const TELEGRAM_LOGIN_BOT_TOKEN = process.env.TELEGRAM_LOGIN_BOT_TOKEN ?? "";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "credentials",
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (typeof credentials?.email !== "string" || typeof credentials?.password !== "string") {
          return null;
        }
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, credentials.email))
          .limit(1);
        if (!user || !user.passwordHash) return null;
        if (!user.emailVerifiedAt) return null;
        const ok = await verifyPassword(credentials.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.fullName ?? undefined,
          telegramId: user.telegramId?.toString() ?? null,
        };
      },
    }),
    Credentials({
      id: "telegram",
      name: "Telegram",
      credentials: { payload: { label: "Payload", type: "text" } },
      async authorize(input) {
        if (!TELEGRAM_LOGIN_BOT_TOKEN) return null;
        if (typeof input?.payload !== "string") return null;
        let parsed: unknown;
        try {
          parsed = JSON.parse(input.payload);
        } catch {
          return null;
        }
        if (!parsed || typeof parsed !== "object") return null;
        const result = verifyTelegramAuth(
          parsed as Parameters<typeof verifyTelegramAuth>[0],
          TELEGRAM_LOGIN_BOT_TOKEN,
        );
        if (!result.ok) return null;
        const tgUser = result.user;
        // Find or create user by telegram_id.
        const [existing] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.telegramId, tgUser.id))
          .limit(1);
        let userId: string;
        if (existing) {
          userId = existing.id;
        } else {
          const [created] = await db
            .insert(schema.users)
            .values({
              telegramId: tgUser.id,
              telegramUsername: tgUser.username ?? null,
              fullName: [tgUser.firstName, tgUser.lastName].filter(Boolean).join(" ") || null,
              emailVerifiedAt: new Date(), // Telegram identity counts as verified
            })
            .returning();
          if (!created) return null;
          userId = created.id;
        }
        return {
          id: userId,
          email: existing?.email ?? null,
          name: [tgUser.firstName, tgUser.lastName].filter(Boolean).join(" ") || undefined,
          telegramId: tgUser.id.toString(),
        };
      },
    }),
  ],
});
```

- [ ] **Step 5: Create `apps/web/app/api/auth/[...nextauth]/route.ts`**

```ts
export { GET, POST } from "@/auth";
```

(NextAuth v5 exports the route handlers from the same module that does config; this file just re-exports them at the API path.)

- [ ] **Step 6: Configure Next.js to bundle the workspace package**

Modify `apps/web/next.config.ts` to add `transpilePackages` and a webpack `extensionAlias`. The full file becomes:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // NOTE: typedRoutes was enabled speculatively in Plan 1 but is DROPPED in
  // Plan 2 Task 9. The dashboard is built on slug-based dynamic routing
  // (`/[merchantSlug]/...`); nearly every internal link is computed at runtime
  // from a merchant slug, which typedRoutes cannot verify without an
  // `as Route` cast on every href. Removing it avoids pervasive friction.
  // Workspace package (TS source). Next must transpile + map NodeNext .js
  // re-export specifiers back to .ts source.
  transpilePackages: ["@lapakgram/db"],
  webpack(config) {
    // NodeNext-compliant TS source uses `.js` extensions in relative imports
    // (e.g., `import x from "./foo.js"`). tsc resolves these to `.ts`/`.tsx`
    // source via the resolver. Webpack does not by default. extensionAlias
    // tells webpack to try `.ts` then `.tsx` then `.js` whenever a request
    // ends in `.js`. Required for `apps/web` to import from `packages/db`,
    // and for relative `.js` imports inside `apps/web` itself.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default config;
```

Without these two settings, the `import { ... } from "@lapakgram/db"` in `auth.ts` and the relative `./lib/auth/password.js` imports throw "Module not found" at runtime even though `tsc` is happy. The `extensionAlias` is the standard Next.js fix for NodeNext-style projects.

- [ ] **Step 7: Verify typecheck**

Run: `pnpm --filter @lapakgram/web typecheck`
Expected: clean.

- [ ] **Step 8: Smoke-test the auth route**

Start the dev server: `pnpm --filter @lapakgram/web dev`

In another terminal:

```
curl -i http://localhost:3000/api/auth/csrf
```

Expected: 200, returns `{ "csrfToken": "..." }`.

```
curl -i http://localhost:3000/api/auth/providers
```

Expected: 200, returns JSON listing `credentials` and `telegram` providers.

Stop the dev server.

If `pnpm --filter @lapakgram/web dev` boots but the curl probes return 500 with "Module not found" in the server log, double-check that `transpilePackages` and `extensionAlias` are present in `next.config.ts` (Step 6). Also check `.env`: `NEXTAUTH_SECRET` must be at least 32 bytes for NextAuth v5 (`dev_nextauth_secret_change_me_now_32_bytes` is the local fallback if you haven't generated one).

- [ ] **Step 9: Commit**

```
git add apps/web/auth.config.ts apps/web/auth.ts apps/web/app/api/auth apps/web/next.config.ts apps/web/package.json .env.example pnpm-lock.yaml
git commit -m "feat(web): wire NextAuth v5 with email and Telegram providers"
```

---

## Task 7: Login, register, and email verification pages + server actions

**Files:**

- Create: `apps/web/app/(auth)/layout.tsx`
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/(auth)/register/page.tsx`
- Create: `apps/web/app/(auth)/verify-email/page.tsx`
- Create: `apps/web/lib/server-actions/auth.ts`
- Create: `apps/web/lib/email/send.ts`
- Create: `apps/web/tests/server-actions/auth.test.ts`

This task implements the email-flavored auth flow: register -> verify email link -> login. Telegram login uses the widget which is wired in Task 8.

- [ ] **Step 1: Create email send helper**

Create `apps/web/lib/email/send.ts`:

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

/**
 * Dev: writes the email to console. A real provider (Resend, SES, Postmark)
 * plugs in via this same interface in a later plan. Returning a Promise that
 * resolves keeps tests fast and deterministic.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  console.log("--- email ---");
  console.log("to:", msg.to);
  console.log("subject:", msg.subject);
  console.log(msg.textBody);
  console.log("-------------");
}
```

- [ ] **Step 2: Write failing tests for the auth server actions**

Create `apps/web/tests/server-actions/auth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser, consumeEmailVerification } from "../../lib/server-actions/auth.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://lapakgram:lapakgram_dev@localhost:5434/lapakgram_test_authactions";

// These tests run against a dedicated test database created in the test setup.
// We rely on a small bootstrap helper to create + migrate it. If you use
// testcontainers in this file too, swap the bootstrap accordingly.

describe("auth server actions", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("registerUser creates a user and an email verification token", async () => {
    const result = await registerUser({
      email: `user+${Date.now()}@example.com`,
      password: "password123",
      fullName: "Test User",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.devVerifyUrl).toContain("/verify-email?token=");
    }
  });

  it("rejects duplicate email", async () => {
    const email = `dup+${Date.now()}@example.com`;
    const a = await registerUser({ email, password: "password123" });
    expect(a.ok).toBe(true);
    const b = await registerUser({ email, password: "password123" });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toMatch(/already/i);
  });

  it("consumeEmailVerification marks user verified once and rejects re-use", async () => {
    const reg = await registerUser({
      email: `verify+${Date.now()}@example.com`,
      password: "password123",
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const tokenMatch = reg.devVerifyUrl.match(/token=([^&]+)/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1]!;
    const consume1 = await consumeEmailVerification(token);
    expect(consume1.ok).toBe(true);
    const consume2 = await consumeEmailVerification(token);
    expect(consume2.ok).toBe(false);
  });

  it("rejects invalid token", async () => {
    const result = await consumeEmailVerification("not-a-real-token");
    expect(result.ok).toBe(false);
  });
});
```

This test file uses a separate test database. The setup helper for it lives at `apps/web/tests/_helpers/db.ts` (created next).

- [ ] **Step 3: Create test DB helper**

Create `apps/web/tests/_helpers/db.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import postgres from "postgres";

const ADMIN_URL =
  process.env.TEST_ADMIN_URL ?? "postgres://lapakgram:lapakgram_dev@localhost:5434/postgres";

export async function ensureTestDb(testDbName: string): Promise<string> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${testDbName}`);
  await admin.unsafe(`CREATE DATABASE ${testDbName}`);
  await admin.end({ timeout: 5 });

  const dbUrl = ADMIN_URL.replace(/\/postgres$/, `/${testDbName}`);
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

  // Apply repo migrations
  const dir = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sqlText = readFileSync(join(dir, file), "utf8");
    await sql.unsafe(sqlText);
  }
  await sql.end({ timeout: 5 });
  return dbUrl;
}
```

Note: this helper expects the postgres bootstrap user to have CREATE DATABASE rights, which the docker-compose Postgres bootstrap user does. It's a destructive helper — only call from test code.

- [ ] **Step 4: Wire test DB setup in vitest config**

Update `apps/web/vitest.config.ts` to load env and run setup:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/_helpers/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

Create `apps/web/tests/_helpers/setup.ts`:

```ts
import { beforeAll } from "vitest";
import { ensureTestDb } from "./db.js";

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) return;
  const url = await ensureTestDb("lapakgram_test_web");
  process.env.TEST_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
});
```

- [ ] **Step 5: Run tests, verify they FAIL**

Run: `pnpm --filter @lapakgram/web test tests/server-actions/auth.test.ts`
Expected: FAIL with import error (server actions not yet implemented).

- [ ] **Step 6: Implement `apps/web/lib/server-actions/auth.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";
import { hashPassword } from "../auth/password.js";
import { sendEmail } from "../email/send.js";

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  return createDb(url);
}

const VERIFY_TTL_HOURS = 24;

export type RegisterResult =
  | { ok: true; userId: string; devVerifyUrl: string }
  | { ok: false; reason: string };

export async function registerUser(input: {
  email: string;
  password: string;
  fullName?: string;
}): Promise<RegisterResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "invalid email" };
  }
  if (input.password.length < 8) {
    return { ok: false, reason: "password must be at least 8 chars" };
  }
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) return { ok: false, reason: "email already registered" };

  const passwordHash = await hashPassword(input.password);

  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      fullName: input.fullName ?? null,
    })
    .returning({ id: schema.users.id });
  if (!user) return { ok: false, reason: "insert failed" };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 3600 * 1000);
  await db.insert(schema.emailVerifications).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const verifyUrl = `${
    process.env.NEXTAUTH_URL ?? "http://localhost:3000"
  }/verify-email?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Verify your Lapakgram email",
    textBody: `Halo, klik link berikut untuk verifikasi: ${verifyUrl}\n\nLink berlaku ${VERIFY_TTL_HOURS} jam.`,
  });

  return { ok: true, userId: user.id, devVerifyUrl: verifyUrl };
}

export type ConsumeResult = { ok: true; userId: string } | { ok: false; reason: string };

export async function consumeEmailVerification(token: string): Promise<ConsumeResult> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = getDb();

  const [row] = await db
    .select()
    .from(schema.emailVerifications)
    .where(
      and(
        eq(schema.emailVerifications.tokenHash, tokenHash),
        isNull(schema.emailVerifications.consumedAt),
        gt(schema.emailVerifications.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, reason: "invalid or expired token" };

  await db.transaction(async (tx) => {
    await tx
      .update(schema.emailVerifications)
      .set({ consumedAt: new Date() })
      .where(eq(schema.emailVerifications.id, row.id));
    await tx
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, row.userId));
  });

  return { ok: true, userId: row.userId };
}
```

- [ ] **Step 7: Run tests, verify they PASS**

Run: `pnpm --filter @lapakgram/web test tests/server-actions/auth.test.ts`
Expected: 4/4 passing.

- [ ] **Step 8: Build the auth pages**

Create `apps/web/app/(auth)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">{children}</div>
    </div>
  );
}
```

Create `apps/web/app/(auth)/register/page.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { registerUser } from "@/lib/server-actions/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setMessage(null);
        const result = await registerUser({ email, password, fullName });
        setSubmitting(false);
        if (result.ok) {
          setMessage("Registrasi berhasil. Cek email kamu untuk link verifikasi.");
          setDevUrl(result.devVerifyUrl);
        } else {
          setMessage(`Gagal: ${result.reason}`);
        }
      }}
    >
      <h1 className="text-2xl font-bold">Daftar Lapakgram</h1>
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Nama lengkap"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Password (min 8)"
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        type="submit"
        className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
        disabled={submitting}
      >
        {submitting ? "Mengirim…" : "Daftar"}
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      {devUrl ? (
        <p className="break-all text-xs text-slate-500">
          Dev verify URL:{" "}
          <Link className="underline" href={devUrl}>
            {devUrl}
          </Link>
        </p>
      ) : null}
      <p className="text-sm">
        Sudah punya akun?{" "}
        <Link className="underline" href="/login">
          Login
        </Link>
      </p>
      <p className="text-xs text-slate-500">{router.refresh ? "" : ""}</p>
    </form>
  );
}
```

Create `apps/web/app/(auth)/login/page.tsx`:

```tsx
"use client";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        const res = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });
        setSubmitting(false);
        if (res?.error) {
          setError("Email atau password salah, atau email belum diverifikasi.");
        } else if (res?.ok) {
          window.location.href = "/new-merchant";
        }
      }}
    >
      <h1 className="text-2xl font-bold">Masuk</h1>
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Password"
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        type="submit"
        className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
        disabled={submitting}
      >
        {submitting ? "…" : "Masuk"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <p className="text-sm">
        Belum punya akun?{" "}
        <Link className="underline" href="/register">
          Daftar
        </Link>
      </p>
      <p className="text-xs text-slate-500">Login dengan Telegram tersedia di Task 8.</p>
    </form>
  );
}
```

Create `apps/web/app/(auth)/verify-email/page.tsx`:

```tsx
import Link from "next/link";
import { consumeEmailVerification } from "@/lib/server-actions/auth";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { token } = await searchParams;
  if (!token) {
    return <p>Token tidak ditemukan.</p>;
  }
  const result = await consumeEmailVerification(token);
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Verifikasi gagal</h1>
        <p>{result.reason}</p>
        <Link className="underline" href="/login">
          Kembali ke login
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Email diverifikasi ✓</h1>
      <p>Sekarang kamu bisa masuk.</p>
      <Link className="underline" href="/login">
        Lanjut ke login
      </Link>
    </div>
  );
}
```

- [ ] **Step 9: Manual smoke test**

```
pnpm --filter @lapakgram/web dev
```

Open http://localhost:3000/register, fill the form, submit. The dev console should print the verification email and the page should display the dev URL link. Click it (it's same-origin) and you should see the verification success page. Then go to /login and sign in.

Stop the dev server.

- [ ] **Step 10: Commit**

```
git add apps/web/app/\(auth\) apps/web/lib/server-actions/auth.ts apps/web/lib/email apps/web/tests apps/web/vitest.config.ts
git commit -m "feat(web): add register, email verification, and login pages"
```

---

## Task 8: Telegram Login Widget integration

**Files:**

- Create: `apps/web/app/(auth)/login/_components/telegram-login.tsx`
- Modify: `apps/web/app/(auth)/login/page.tsx`

The Telegram Login Widget is a third-party script that loads `https://telegram.org/js/telegram-widget.js` and posts the auth payload back to a callback URL. We embed it on the login page; on success it forwards the payload to NextAuth's `telegram` provider via `signIn`.

- [ ] **Step 1: Create the Telegram Login client component**

Create `apps/web/app/(auth)/login/_components/telegram-login.tsx`:

```tsx
"use client";
import { signIn } from "next-auth/react";
import Script from "next/script";
import { useEffect } from "react";

interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    onTelegramAuth?: (data: TelegramAuthData) => void;
  }
}

export function TelegramLogin({ botUsername }: { botUsername: string }) {
  useEffect(() => {
    window.onTelegramAuth = async (data) => {
      const res = await signIn("telegram", {
        payload: JSON.stringify(data),
        redirect: false,
      });
      if (res?.ok) {
        window.location.href = "/new-merchant";
      }
    };
    return () => {
      delete window.onTelegramAuth;
    };
  }, []);

  if (!botUsername) {
    return (
      <p className="text-xs text-slate-500">
        Telegram login belum dikonfigurasi (set TELEGRAM_LOGIN_BOT_USERNAME).
      </p>
    );
  }

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login={botUsername}
        data-size="large"
        data-onauth="onTelegramAuth(user)"
        data-request-access="write"
        strategy="afterInteractive"
      />
    </>
  );
}
```

- [ ] **Step 2: Update login page to include the widget**

Modify `apps/web/app/(auth)/login/page.tsx`. Replace the existing file with:

```tsx
"use client";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { TelegramLogin } from "./_components/telegram-login";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME ?? "";

  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          const res = await signIn("credentials", {
            email,
            password,
            redirect: false,
          });
          setSubmitting(false);
          if (res?.error) {
            setError("Email atau password salah, atau email belum diverifikasi.");
          } else if (res?.ok) {
            window.location.href = "/new-merchant";
          }
        }}
      >
        <h1 className="text-2xl font-bold">Masuk</h1>
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "…" : "Masuk"}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>

      <div className="flex items-center gap-3">
        <div className="flex-1 border-t" />
        <span className="text-xs uppercase text-slate-500">atau</span>
        <div className="flex-1 border-t" />
      </div>

      <div className="flex justify-center">
        <TelegramLogin botUsername={botUsername} />
      </div>

      <p className="text-sm">
        Belum punya akun?{" "}
        <Link className="underline" href="/register">
          Daftar
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Add NEXT*PUBLIC* env var**

Update `.env.example` to add (after `TELEGRAM_LOGIN_BOT_USERNAME`):

```
# Public mirror of TELEGRAM_LOGIN_BOT_USERNAME for client-side widget rendering.
NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME=
```

- [ ] **Step 4: Manual smoke test**

To test end-to-end you need a real Telegram bot username configured at Telegram BotFather. Skip this step if you don't have one yet — the widget will render the "not configured" message and the email login still works. The unit tests in Task 3 already cover the HMAC verifier logic.

- [ ] **Step 5: Commit**

```
git add apps/web/app/\(auth\)/login .env.example
git commit -m "feat(web): add Telegram Login Widget on login page"
```

---

## Task 9: Merchant create flow + multi-merchant context switcher

**Files:**

- Create: `apps/web/lib/server-actions/merchant.ts`
- Create: `apps/web/app/(dashboard)/layout.tsx`
- Create: `apps/web/app/(dashboard)/new-merchant/page.tsx`
- Create: `apps/web/app/(dashboard)/[merchantSlug]/layout.tsx`
- Create: `apps/web/app/(dashboard)/[merchantSlug]/page.tsx`
- Create: `apps/web/app/(dashboard)/_components/merchant-switcher.tsx`
- Create: `apps/web/tests/server-actions/merchant.test.ts`

- [ ] **Step 1: Write failing tests for merchant server actions**

Create `apps/web/tests/server-actions/merchant.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createMerchant, listMerchantsForUser } from "../../lib/server-actions/merchant.js";
import { registerUser, consumeEmailVerification } from "../../lib/server-actions/auth.js";

async function freshUser() {
  const reg = await registerUser({
    email: `merch+${Date.now()}+${Math.random()}@example.com`,
    password: "password123",
    fullName: "Merchant Owner",
  });
  if (!reg.ok) throw new Error(reg.reason);
  const tokenMatch = reg.devVerifyUrl.match(/token=([^&]+)/);
  await consumeEmailVerification(tokenMatch![1]!);
  return reg.userId;
}

describe("merchant server actions", () => {
  afterEach(() => {
    /* DB stays alive; each test uses fresh user/merchant */
  });

  it("createMerchant inserts merchant + ownership + trial subscription", async () => {
    const userId = await freshUser();
    const slug = `shop-${Date.now()}`;
    const result = await createMerchant({ userId, name: "Shop One", slug });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merchantId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.slug).toBe(slug);
    }
  });

  it("rejects duplicate slug", async () => {
    const userId = await freshUser();
    const slug = `dupslug-${Date.now()}`;
    const a = await createMerchant({ userId, name: "A", slug });
    expect(a.ok).toBe(true);
    const b = await createMerchant({ userId, name: "B", slug });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toMatch(/slug/i);
  });

  it("rejects invalid slug (too short, special chars)", async () => {
    const userId = await freshUser();
    const tooShort = await createMerchant({ userId, name: "X", slug: "ab" });
    expect(tooShort.ok).toBe(false);
    const special = await createMerchant({ userId, name: "X", slug: "Has Spaces" });
    expect(special.ok).toBe(false);
  });

  it("listMerchantsForUser returns owned merchants with role=owner", async () => {
    const userId = await freshUser();
    const slug = `list-${Date.now()}`;
    await createMerchant({ userId, name: "Listed", slug });
    const list = await listMerchantsForUser(userId);
    expect(list.length).toBeGreaterThan(0);
    const found = list.find((m) => m.slug === slug);
    expect(found).toBeDefined();
    expect(found?.role).toBe("owner");
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `pnpm --filter @lapakgram/web test tests/server-actions/merchant.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/lib/server-actions/merchant.ts`**

```ts
import { eq } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,31}$/;
const TRIAL_DAYS = 14;

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  return createDb(url);
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
    return { ok: false, reason: "slug must be 3-32 chars, lowercase a-z, 0-9, dash" };
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

  // Find or create the trial plan.
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

  const merchantId = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(schema.merchants)
      .values({
        slug,
        name: input.name.trim(),
        planId: trialPlan!.id,
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
      planId: trialPlan!.id,
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

export async function listMerchantsForUser(userId: string): Promise<MerchantListItem[]> {
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
    .innerJoin(schema.merchants, eq(schema.merchantMembers.merchantId, schema.merchants.id))
    .where(eq(schema.merchantMembers.userId, userId));
  return rows;
}
```

- [ ] **Step 4: Run tests, verify they PASS**

Run: `pnpm --filter @lapakgram/web test tests/server-actions/merchant.test.ts`
Expected: 4/4 passing.

- [ ] **Step 5: Build dashboard layout**

Create `apps/web/app/(dashboard)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
```

Create `apps/web/app/(dashboard)/new-merchant/page.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createMerchant } from "@/lib/server-actions/merchant";
import { useSession } from "next-auth/react";

export default function NewMerchantPage() {
  const router = useRouter();
  const { data } = useSession();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-md p-8">
      <form
        className="space-y-4 rounded-lg bg-white p-6 shadow"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!data?.user?.id) return;
          setSubmitting(true);
          setError(null);
          const result = await createMerchant({ userId: data.user.id, name, slug });
          setSubmitting(false);
          if (result.ok) {
            router.push(`/${result.slug}/settings/bot`);
          } else {
            setError(result.reason);
          }
        }}
      >
        <h1 className="text-2xl font-bold">Buat Toko</h1>
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Nama toko"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="slug-toko (huruf kecil, angka, dash)"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "…" : "Buat toko & lanjut setup bot"}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </div>
  );
}
```

Create `apps/web/app/(dashboard)/[merchantSlug]/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
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

  const db = createDb(process.env.DATABASE_URL!);
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.slug, merchantSlug))
    .limit(1);
  if (!merchant) notFound();

  const [membership] = await db
    .select({ role: schema.merchantMembers.role })
    .from(schema.merchantMembers)
    .where(eq(schema.merchantMembers.merchantId, merchant.id))
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
```

Create `apps/web/app/(dashboard)/[merchantSlug]/page.tsx`:

```tsx
export default async function OverviewPage({
  params,
}: {
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Overview</h1>
      <p className="text-slate-600">Merchant: {merchantSlug}</p>
      <p className="text-slate-500">Katalog dan order belum aktif (Plan 4).</p>
    </div>
  );
}
```

Create `apps/web/app/(dashboard)/_components/merchant-switcher.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import type { MerchantListItem } from "@/lib/server-actions/merchant";

export function MerchantSwitcher({ items, active }: { items: MerchantListItem[]; active: string }) {
  const [open, setOpen] = useState(false);
  if (items.length <= 1) return null;
  return (
    <div className="relative">
      <button
        type="button"
        className="rounded border px-3 py-1 text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        Switch ▾
      </button>
      {open ? (
        <ul className="absolute z-10 mt-1 min-w-[200px] rounded border bg-white shadow">
          {items.map((m) => (
            <li key={m.merchantId}>
              <Link
                href={`/${m.slug}`}
                className={`block px-3 py-2 text-sm hover:bg-slate-100 ${
                  m.slug === active ? "font-bold" : ""
                }`}
              >
                {m.name}
              </Link>
            </li>
          ))}
          <li className="border-t">
            <Link href="/new-merchant" className="block px-3 py-2 text-sm hover:bg-slate-100">
              + Buat toko baru
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Manual smoke test**

```
pnpm --filter @lapakgram/web dev
```

After login, you should be redirected to `/new-merchant`. Create a merchant; it should redirect to `/<slug>/settings/bot` (page exists in next task). For now /new-merchant + the dashboard layout should render correctly.

Stop the dev server.

- [ ] **Step 7: Commit**

```
git add apps/web/lib/server-actions/merchant.ts apps/web/app/\(dashboard\) apps/web/tests/server-actions/merchant.test.ts
git commit -m "feat(web): add merchant create flow, dashboard layout, and merchant switcher"
```

---

## Task 10: Bot wizard — validate token, encrypt, set webhook

**Files:**

- Create: `apps/web/lib/telegram/client.ts`
- Create: `apps/web/lib/server-actions/bot.ts`
- Create: `apps/web/app/(dashboard)/[merchantSlug]/settings/bot/page.tsx`
- Create: `apps/web/tests/server-actions/bot.test.ts`

The bot wizard:

1. Shows instructions for creating a bot at @BotFather
2. Merchant pastes the bot token
3. Server calls Telegram `getMe` to validate, encrypts the token using `MASTER_ENCRYPTION_KEY`, stores it
4. Server calls Telegram `setWebhook` pointing at our app's `/api/webhooks/telegram/<webhook_secret>`, with `secret_token` header binding
5. Bot is "online" — sending `/start` to the bot triggers our webhook stub (Task 11)

- [ ] **Step 1: Create thin Telegram REST client**

Create `apps/web/lib/telegram/client.ts`:

```ts
const BASE = "https://api.telegram.org";

export interface GetMeResult {
  ok: boolean;
  result?: { id: number; is_bot: boolean; username: string; first_name: string };
  description?: string;
}

export async function getMe(token: string): Promise<GetMeResult> {
  const r = await fetch(`${BASE}/bot${token}/getMe`, { method: "GET" });
  return (await r.json()) as GetMeResult;
}

export interface SetWebhookOptions {
  url: string;
  secretToken?: string;
  dropPendingUpdates?: boolean;
}

export interface SetWebhookResult {
  ok: boolean;
  description?: string;
}

export async function setWebhook(
  token: string,
  options: SetWebhookOptions,
): Promise<SetWebhookResult> {
  const body = new URLSearchParams();
  body.set("url", options.url);
  if (options.secretToken) body.set("secret_token", options.secretToken);
  if (options.dropPendingUpdates) body.set("drop_pending_updates", "true");
  const r = await fetch(`${BASE}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return (await r.json()) as SetWebhookResult;
}

export async function deleteWebhook(token: string): Promise<SetWebhookResult> {
  const r = await fetch(`${BASE}/bot${token}/deleteWebhook`, { method: "POST" });
  return (await r.json()) as SetWebhookResult;
}
```

- [ ] **Step 2: Write failing tests for the bot server actions (with fetch mocks)**

Create `apps/web/tests/server-actions/bot.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";
import { decryptSecret, parseKeyFromBase64 } from "../../lib/crypto.js";
import { setupBotForMerchant } from "../../lib/server-actions/bot.js";
import { createMerchant } from "../../lib/server-actions/merchant.js";
import { registerUser, consumeEmailVerification } from "../../lib/server-actions/auth.js";

async function freshOwnerAndMerchant() {
  const reg = await registerUser({
    email: `bot+${Date.now()}+${Math.random()}@example.com`,
    password: "password123",
  });
  if (!reg.ok) throw new Error(reg.reason);
  await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);
  const m = await createMerchant({
    userId: reg.userId,
    name: "Bot Test",
    slug: `bot-${Date.now()}`,
  });
  if (!m.ok) throw new Error(m.reason);
  return { userId: reg.userId, merchantId: m.merchantId };
}

const FAKE_KEY = Buffer.alloc(32, 5).toString("base64");

describe("bot server actions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates token via getMe, encrypts and stores it, sets webhook", async () => {
    const { merchantId } = await freshOwnerAndMerchant();
    process.env.MASTER_ENCRYPTION_KEY = FAKE_KEY;
    process.env.NEXTAUTH_URL = "http://localhost:3000";

    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/getMe")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 1234567890,
              is_bot: true,
              username: "lapakgram_test_bot",
              first_name: "Test",
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/setWebhook")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 500 });
    });

    const result = await setupBotForMerchant({
      merchantId,
      botToken: "1234567890:AAH-FAKE-TOKEN",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.botUsername).toBe("lapakgram_test_bot");
      expect(result.botId).toBe("1234567890");
    }

    const db = createDb(process.env.DATABASE_URL!);
    const [m] = await db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.id, merchantId))
      .limit(1);
    expect(m?.status).toBe("active");
    expect(m?.botUsername).toBe("lapakgram_test_bot");
    expect(m?.webhookSecret).toBeTruthy();
    expect(m?.webhookTelegramSecret).toBeTruthy();
    expect(m?.botTokenEncrypted).toBeTruthy();

    // Decrypt and verify roundtrip
    const key = parseKeyFromBase64(FAKE_KEY);
    const blob = m?.botTokenEncrypted as unknown as Buffer;
    expect(decryptSecret(blob, key)).toBe("1234567890:AAH-FAKE-TOKEN");

    // Verify setWebhook was called with our URL pattern
    const setWebhookCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/setWebhook"));
    expect(setWebhookCall).toBeTruthy();
  });

  it("rejects token when Telegram getMe returns ok=false", async () => {
    const { merchantId } = await freshOwnerAndMerchant();
    process.env.MASTER_ENCRYPTION_KEY = FAKE_KEY;
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }),
    );
    const result = await setupBotForMerchant({
      merchantId,
      botToken: "bogus",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unauthorized|invalid/i);
  });

  it("rolls back DB if setWebhook fails", async () => {
    const { merchantId } = await freshOwnerAndMerchant();
    process.env.MASTER_ENCRYPTION_KEY = FAKE_KEY;
    process.env.NEXTAUTH_URL = "http://localhost:3000";

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/getMe")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { id: 1, is_bot: true, username: "u", first_name: "f" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: false, description: "Bad webhook" }), {
        status: 200,
      });
    });

    const result = await setupBotForMerchant({ merchantId, botToken: "12:T" });
    expect(result.ok).toBe(false);

    const db = createDb(process.env.DATABASE_URL!);
    const [m] = await db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.id, merchantId))
      .limit(1);
    expect(m?.status).toBe("pending_setup");
    expect(m?.botTokenEncrypted).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests, verify they FAIL**

Run: `pnpm --filter @lapakgram/web test tests/server-actions/bot.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `apps/web/lib/server-actions/bot.ts`**

```ts
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";
import { encryptSecret, parseKeyFromBase64 } from "../crypto.js";
import { getMe, setWebhook } from "../telegram/client.js";

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  return createDb(url);
}

export type SetupBotResult =
  | { ok: true; botUsername: string; botId: string }
  | { ok: false; reason: string };

export async function setupBotForMerchant(input: {
  merchantId: string;
  botToken: string;
}): Promise<SetupBotResult> {
  const tokenTrim = input.botToken.trim();
  if (!/^[0-9]+:[A-Za-z0-9_-]{30,}$/.test(tokenTrim)) {
    return { ok: false, reason: "token format invalid" };
  }
  const masterKeyB64 = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKeyB64) return { ok: false, reason: "MASTER_ENCRYPTION_KEY not set" };
  const masterKey = parseKeyFromBase64(masterKeyB64);

  // 1. Validate via getMe
  const me = await getMe(tokenTrim);
  if (!me.ok || !me.result) {
    return { ok: false, reason: me.description ?? "getMe failed" };
  }
  if (!me.result.is_bot) {
    return { ok: false, reason: "token does not represent a bot" };
  }
  const botId = me.result.id;
  const botUsername = me.result.username;

  // 2. Generate webhook secrets
  const webhookSecret = randomBytes(24).toString("base64url");
  const webhookTelegramSecret = randomBytes(32).toString("base64url");
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const webhookUrl = `${baseUrl}/api/webhooks/telegram/${webhookSecret}`;

  // 3. Persist token + secrets (status still pending_setup until webhook confirmed)
  const encrypted = encryptSecret(tokenTrim, masterKey);
  const db = getDb();
  await db
    .update(schema.merchants)
    .set({
      botTokenEncrypted: encrypted,
      botTokenKeyVersion: 1,
      botUsername,
      botId: BigInt(botId),
      webhookSecret,
      webhookTelegramSecret,
    })
    .where(eq(schema.merchants.id, input.merchantId));

  // 4. Call Telegram setWebhook
  const wh = await setWebhook(tokenTrim, {
    url: webhookUrl,
    secretToken: webhookTelegramSecret,
    dropPendingUpdates: true,
  });
  if (!wh.ok) {
    // Roll back token storage so the user can retry cleanly.
    await db
      .update(schema.merchants)
      .set({
        botTokenEncrypted: null,
        botUsername: null,
        botId: null,
        webhookSecret: null,
        webhookTelegramSecret: null,
      })
      .where(eq(schema.merchants.id, input.merchantId));
    return { ok: false, reason: wh.description ?? "setWebhook failed" };
  }

  // 5. Mark merchant active
  await db
    .update(schema.merchants)
    .set({ status: "active" })
    .where(eq(schema.merchants.id, input.merchantId));

  return { ok: true, botUsername, botId: String(botId) };
}
```

Note: this references `../crypto.js` which is at `apps/web/lib/crypto.ts` (created in Plan 1 Task 8). The relative path from `apps/web/lib/server-actions/bot.ts` is `../crypto.js`.

- [ ] **Step 5: Run tests, verify they PASS**

Run: `pnpm --filter @lapakgram/web test tests/server-actions/bot.test.ts`
Expected: 3/3 passing.

- [ ] **Step 6: Build the bot wizard page**

Create `apps/web/app/(dashboard)/[merchantSlug]/settings/bot/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setupBotForMerchant } from "@/lib/server-actions/bot";

export default function BotSetupPage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    { ok: true; botUsername: string } | { ok: false; reason: string } | null
  >(null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Setup bot Telegram</h1>
        <p className="text-slate-600">
          Buat bot baru di{" "}
          <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">
            @BotFather
          </a>{" "}
          lewat Telegram, lalu paste token-nya di sini.
        </p>
        <ol className="list-decimal pl-6 text-sm text-slate-700">
          <li>Buka chat dengan @BotFather di Telegram</li>
          <li>
            Kirim <code>/newbot</code> dan ikuti instruksi (nama + username)
          </li>
          <li>
            BotFather akan kasih token format <code>123456:ABC-...</code>
          </li>
          <li>Paste token-nya di form di bawah</li>
        </ol>
      </div>

      <form
        className="space-y-4 rounded-lg bg-white p-6 shadow"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setResult(null);
          const merchantId = (e.currentTarget.elements.namedItem("merchantId") as HTMLInputElement)
            .value;
          const r = await setupBotForMerchant({ merchantId, botToken: token });
          setSubmitting(false);
          setResult(r);
          if (r.ok) {
            const { merchantSlug } = await params;
            setTimeout(() => router.push(`/${merchantSlug}`), 1500);
          }
        }}
      >
        <BotInputs />
        <input
          className="w-full rounded border px-3 py-2 font-mono text-sm"
          placeholder="123456:ABC-DEF1234ghIkl-..."
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "Memvalidasi…" : "Connect bot"}
        </button>
        {result?.ok ? (
          <p className="text-sm text-green-700">
            ✓ Bot @{result.botUsername} terhubung. Mengarahkan ke overview…
          </p>
        ) : null}
        {result && !result.ok ? (
          <p className="text-sm text-red-600">Gagal: {result.reason}</p>
        ) : null}
      </form>
    </div>
  );
}

async function BotInputs(this: void) {
  // Helper that fetches the merchant id by slug for the hidden input.
  return null;
}
```

The above page uses a placeholder; we need the merchantId server-side. Replace the page with this server-component-driven version. Replace the entire file:

```tsx
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { createDb, schema } from "@lapakgram/db";
import { BotSetupClient } from "./_components/bot-setup-client";

interface Props {
  params: Promise<{ merchantSlug: string }>;
}

export default async function BotSetupPage({ params }: Props) {
  const { merchantSlug } = await params;
  const db = createDb(process.env.DATABASE_URL!);
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
```

Create `apps/web/app/(dashboard)/[merchantSlug]/settings/bot/_components/bot-setup-client.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setupBotForMerchant } from "@/lib/server-actions/bot";

export function BotSetupClient({
  merchantId,
  merchantSlug,
  currentBotUsername,
}: {
  merchantId: string;
  merchantSlug: string;
  currentBotUsername: string | null;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    { ok: true; botUsername: string } | { ok: false; reason: string } | null
  >(null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Setup bot Telegram</h1>
        {currentBotUsername ? (
          <p className="text-sm text-slate-600">
            Bot saat ini: <code>@{currentBotUsername}</code>. Paste token baru untuk ganti.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Buat bot baru di{" "}
            <Link className="underline" href="https://t.me/BotFather" target="_blank">
              @BotFather
            </Link>
            , lalu paste token-nya.
          </p>
        )}
        <ol className="list-decimal pl-6 text-sm text-slate-700">
          <li>Buka chat dengan @BotFather di Telegram</li>
          <li>
            Kirim <code>/newbot</code> dan ikuti instruksi (nama + username)
          </li>
          <li>
            BotFather akan kasih token format <code>123456:ABC-...</code>
          </li>
          <li>Paste token-nya di form di bawah</li>
        </ol>
      </div>

      <form
        className="space-y-4 rounded-lg bg-white p-6 shadow"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setResult(null);
          const r = await setupBotForMerchant({ merchantId, botToken: token });
          setSubmitting(false);
          setResult(r);
          if (r.ok) {
            setTimeout(() => router.push(`/${merchantSlug}`), 1500);
          }
        }}
      >
        <input
          className="w-full rounded border px-3 py-2 font-mono text-sm"
          placeholder="123456:ABC-DEF1234ghIkl-..."
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "Memvalidasi…" : "Connect bot"}
        </button>
        {result?.ok ? (
          <p className="text-sm text-green-700">✓ Bot @{result.botUsername} terhubung.</p>
        ) : null}
        {result && !result.ok ? (
          <p className="text-sm text-red-600">Gagal: {result.reason}</p>
        ) : null}
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```
git add apps/web/lib/telegram apps/web/lib/server-actions/bot.ts apps/web/app/\(dashboard\)/\[merchantSlug\]/settings/bot apps/web/tests/server-actions/bot.test.ts
git commit -m "feat(web): add bot setup wizard (validate token, encrypt, set webhook)"
```

---

## Task 11: Bot webhook stub route

**Files:**

- Create: `apps/web/app/api/webhooks/telegram/[secret]/route.ts`

This stub validates the request, looks up the merchant, decrypts the bot token, and replies to `/start` with a stub welcome message. Plan 3 will replace this whole route with routing to the Go bot service.

- [ ] **Step 1: Create the webhook route**

Create `apps/web/app/api/webhooks/telegram/[secret]/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { createDb, schema } from "@lapakgram/db";
import { decryptSecret, parseKeyFromBase64 } from "@/lib/crypto";

export const runtime = "nodejs";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string; first_name?: string };
  };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ secret: string }> },
): Promise<NextResponse> {
  const { secret } = await ctx.params;

  const db = createDb(process.env.DATABASE_URL!);
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.webhookSecret, secret))
    .limit(1);
  if (!merchant) {
    return NextResponse.json({ ok: false, error: "unknown webhook" }, { status: 404 });
  }

  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!headerSecret || headerSecret !== merchant.webhookTelegramSecret) {
    return NextResponse.json({ ok: false, error: "bad secret token" }, { status: 401 });
  }

  if (!merchant.botTokenEncrypted) {
    return NextResponse.json({ ok: true, note: "merchant has no token (stub)" });
  }

  const update = (await req.json()) as TelegramUpdate;
  const text = update.message?.text;
  const chatId = update.message?.chat.id;

  // Decrypt token to call sendMessage. (Plan 3 moves this to Go bot service.)
  const masterKey = parseKeyFromBase64(process.env.MASTER_ENCRYPTION_KEY!);
  const token = decryptSecret(merchant.botTokenEncrypted as unknown as Buffer, masterKey);

  if (text === "/start" && chatId) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Halo! Toko ${merchant.name} sedang disiapkan. Fitur belanja akan aktif segera.`,
      }),
    });
  }

  // Respond fast; Telegram retries if we take >2s.
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Manual smoke test (requires real bot)**

If you have a real bot token configured via the wizard:

1. Open the bot in Telegram, send `/start`
2. The bot should reply with the stub welcome message

If you don't have a real bot, skip — Task 14 (Playwright E2E) covers the wired-up flow against a stubbed Telegram API.

- [ ] **Step 3: Commit**

```
git add apps/web/app/api/webhooks/telegram
git commit -m "feat(web): add Telegram webhook stub route (Plan 3 replaces with Go service)"
```

---

## Task 12: Multi-admin invite flow + RBAC middleware

**Files:**

- Create: `apps/web/lib/server-actions/members.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/app/(auth)/invite/[token]/page.tsx`
- Create: `apps/web/app/(dashboard)/[merchantSlug]/settings/team/page.tsx`
- Create: `apps/web/tests/server-actions/members.test.ts`

- [ ] **Step 1: Write failing tests for member server actions**

Create `apps/web/tests/server-actions/members.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  inviteMember,
  acceptInvite,
  changeMemberRole,
  removeMember,
  listMembers,
} from "../../lib/server-actions/members.js";
import { createMerchant } from "../../lib/server-actions/merchant.js";
import { registerUser, consumeEmailVerification } from "../../lib/server-actions/auth.js";

async function freshUserMerchant() {
  const reg = await registerUser({
    email: `m+${Date.now()}+${Math.random()}@example.com`,
    password: "password123",
    fullName: "Owner",
  });
  if (!reg.ok) throw new Error(reg.reason);
  await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);
  const m = await createMerchant({
    userId: reg.userId,
    name: "Inv Test",
    slug: `inv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  });
  if (!m.ok) throw new Error(m.reason);
  return { ownerId: reg.userId, merchantId: m.merchantId };
}

describe("members", () => {
  it("owner can invite a teammate by email and the invitee can accept", async () => {
    process.env.INVITE_SIGNING_SECRET = Buffer.alloc(32, 1).toString("base64");
    const { ownerId, merchantId } = await freshUserMerchant();
    const inviteeEmail = `invitee+${Date.now()}@example.com`;

    const inv = await inviteMember({
      actorUserId: ownerId,
      merchantId,
      email: inviteeEmail,
      role: "support",
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    // Register the invitee
    const reg = await registerUser({ email: inviteeEmail, password: "password123" });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);

    // Accept the invite
    const accept = await acceptInvite({ userId: reg.userId, token: inv.token });
    expect(accept.ok).toBe(true);
    if (accept.ok) expect(accept.merchantId).toBe(merchantId);

    // Member is listed with the invited role
    const list = await listMembers({ actorUserId: ownerId, merchantId });
    expect(list.ok).toBe(true);
    if (list.ok) {
      const m = list.members.find((x) => x.userId === reg.userId);
      expect(m?.role).toBe("support");
    }
  });

  it("non-owner without members:invite cannot invite", async () => {
    process.env.INVITE_SIGNING_SECRET = Buffer.alloc(32, 1).toString("base64");
    const { ownerId, merchantId } = await freshUserMerchant();

    // Create a finance member (cannot invite)
    const financeReg = await registerUser({
      email: `fin+${Date.now()}@example.com`,
      password: "password123",
    });
    if (!financeReg.ok) return;
    await consumeEmailVerification(financeReg.devVerifyUrl.match(/token=([^&]+)/)![1]!);
    const inv1 = await inviteMember({
      actorUserId: ownerId,
      merchantId,
      email: `fin+${Date.now()}@example.com`,
      role: "finance",
    });
    if (inv1.ok) await acceptInvite({ userId: financeReg.userId, token: inv1.token });

    const tryInvite = await inviteMember({
      actorUserId: financeReg.userId,
      merchantId,
      email: `nope+${Date.now()}@example.com`,
      role: "support",
    });
    expect(tryInvite.ok).toBe(false);
  });

  it("owner can change role and remove members", async () => {
    process.env.INVITE_SIGNING_SECRET = Buffer.alloc(32, 1).toString("base64");
    const { ownerId, merchantId } = await freshUserMerchant();
    const inviteeEmail = `change+${Date.now()}@example.com`;
    const inv = await inviteMember({
      actorUserId: ownerId,
      merchantId,
      email: inviteeEmail,
      role: "support",
    });
    if (!inv.ok) return;
    const reg = await registerUser({ email: inviteeEmail, password: "password123" });
    if (!reg.ok) return;
    await consumeEmailVerification(reg.devVerifyUrl.match(/token=([^&]+)/)![1]!);
    await acceptInvite({ userId: reg.userId, token: inv.token });

    const changed = await changeMemberRole({
      actorUserId: ownerId,
      merchantId,
      targetUserId: reg.userId,
      newRole: "admin",
    });
    expect(changed.ok).toBe(true);

    const removed = await removeMember({
      actorUserId: ownerId,
      merchantId,
      targetUserId: reg.userId,
    });
    expect(removed.ok).toBe(true);
  });

  it("cannot remove last owner", async () => {
    const { ownerId, merchantId } = await freshUserMerchant();
    const result = await removeMember({
      actorUserId: ownerId,
      merchantId,
      targetUserId: ownerId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/last owner|cannot remove/i);
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `pnpm --filter @lapakgram/web test tests/server-actions/members.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/lib/server-actions/members.ts`**

```ts
import { randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";
import { sendEmail } from "../email/send.js";
import { can, type Permission, type Role } from "../permissions.js";
import { createInviteToken, hashInviteToken, verifyInviteToken } from "../auth/invite-token.js";

const INVITE_TTL_HOURS = 168; // 7 days

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  return createDb(url);
}

function getInviteSecret() {
  const s = process.env.INVITE_SIGNING_SECRET;
  if (!s) throw new Error("INVITE_SIGNING_SECRET required");
  return s;
}

async function getMembership(userId: string, merchantId: string): Promise<{ role: Role } | null> {
  const db = getDb();
  const [m] = await db
    .select({ role: schema.merchantMembers.role })
    .from(schema.merchantMembers)
    .where(
      and(
        eq(schema.merchantMembers.userId, userId),
        eq(schema.merchantMembers.merchantId, merchantId),
      ),
    )
    .limit(1);
  if (!m) return null;
  return { role: m.role as Role };
}

async function requirePermission(
  userId: string,
  merchantId: string,
  perm: Permission,
): Promise<{ ok: true; role: Role } | { ok: false; reason: string }> {
  const membership = await getMembership(userId, merchantId);
  if (!membership) return { ok: false, reason: "not a member" };
  if (!can(membership.role, perm)) return { ok: false, reason: "permission denied" };
  return { ok: true, role: membership.role };
}

export type InviteResult =
  | { ok: true; inviteId: string; token: string; acceptUrl: string }
  | { ok: false; reason: string };

export async function inviteMember(input: {
  actorUserId: string;
  merchantId: string;
  email?: string;
  telegramId?: bigint;
  role: Role;
}): Promise<InviteResult> {
  if (!input.email && !input.telegramId) {
    return { ok: false, reason: "email or telegramId required" };
  }
  if (input.role === "owner") {
    return { ok: false, reason: "use ownership transfer flow for owner role" };
  }
  const perm = await requirePermission(input.actorUserId, input.merchantId, "members:invite");
  if (!perm.ok) return perm;

  const db = getDb();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000);

  // Generate a placeholder token to compute hash; we replace with the JWT.
  const placeholder = randomBytes(8).toString("hex");
  const placeholderHash = hashInviteToken(placeholder);

  const [invite] = await db
    .insert(schema.merchantInvites)
    .values({
      merchantId: input.merchantId,
      email: input.email ?? null,
      telegramId: input.telegramId ?? null,
      role: input.role,
      tokenHash: placeholderHash,
      invitedBy: input.actorUserId,
      expiresAt,
    })
    .returning({ id: schema.merchantInvites.id });
  if (!invite) return { ok: false, reason: "invite insert failed" };

  // Now sign a JWT with the real invite id
  const token = await createInviteToken(
    { inviteId: invite.id, merchantId: input.merchantId },
    getInviteSecret(),
    { ttlSeconds: INVITE_TTL_HOURS * 3600 },
  );
  const tokenHash = hashInviteToken(token);
  await db
    .update(schema.merchantInvites)
    .set({ tokenHash })
    .where(eq(schema.merchantInvites.id, invite.id));

  const acceptUrl = `${
    process.env.NEXTAUTH_URL ?? "http://localhost:3000"
  }/invite/${encodeURIComponent(token)}`;

  if (input.email) {
    await sendEmail({
      to: input.email,
      subject: "You've been invited to a Lapakgram team",
      textBody: `Klik link berikut untuk join: ${acceptUrl}\n\nLink berlaku ${INVITE_TTL_HOURS} jam.`,
    });
  }

  return { ok: true, inviteId: invite.id, token, acceptUrl };
}

export type AcceptResult =
  | { ok: true; merchantId: string; role: Role }
  | { ok: false; reason: string };

export async function acceptInvite(input: {
  userId: string;
  token: string;
}): Promise<AcceptResult> {
  const verify = await verifyInviteToken(input.token, getInviteSecret());
  if (!verify.ok) return { ok: false, reason: verify.reason };
  const tokenHash = hashInviteToken(input.token);

  const db = getDb();
  const [invite] = await db
    .select()
    .from(schema.merchantInvites)
    .where(eq(schema.merchantInvites.tokenHash, tokenHash))
    .limit(1);
  if (!invite) return { ok: false, reason: "invite not found" };
  if (invite.acceptedAt) return { ok: false, reason: "invite already used" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "invite expired" };

  // Add membership and mark invite consumed in a transaction.
  await db.transaction(async (tx) => {
    await tx.insert(schema.merchantMembers).values({
      merchantId: invite.merchantId,
      userId: input.userId,
      role: invite.role,
      acceptedAt: new Date(),
    });
    await tx
      .update(schema.merchantInvites)
      .set({ acceptedAt: new Date(), acceptedByUserId: input.userId })
      .where(eq(schema.merchantInvites.id, invite.id));
  });

  return { ok: true, merchantId: invite.merchantId, role: invite.role as Role };
}

export type ChangeRoleResult = { ok: true } | { ok: false; reason: string };

export async function changeMemberRole(input: {
  actorUserId: string;
  merchantId: string;
  targetUserId: string;
  newRole: Role;
}): Promise<ChangeRoleResult> {
  if (input.newRole === "owner") {
    return { ok: false, reason: "use ownership transfer flow for owner role" };
  }
  const perm = await requirePermission(input.actorUserId, input.merchantId, "members:change-role");
  if (!perm.ok) return perm;

  const db = getDb();
  await db
    .update(schema.merchantMembers)
    .set({ role: input.newRole })
    .where(
      and(
        eq(schema.merchantMembers.merchantId, input.merchantId),
        eq(schema.merchantMembers.userId, input.targetUserId),
      ),
    );
  return { ok: true };
}

export type RemoveResult = { ok: true } | { ok: false; reason: string };

export async function removeMember(input: {
  actorUserId: string;
  merchantId: string;
  targetUserId: string;
}): Promise<RemoveResult> {
  const perm = await requirePermission(input.actorUserId, input.merchantId, "members:remove");
  if (!perm.ok) return perm;

  const db = getDb();

  // Don't allow removing the last owner.
  const target = await getMembership(input.targetUserId, input.merchantId);
  if (target?.role === "owner") {
    const [{ value: ownerCount }] = await db
      .select({ value: count() })
      .from(schema.merchantMembers)
      .where(
        and(
          eq(schema.merchantMembers.merchantId, input.merchantId),
          eq(schema.merchantMembers.role, "owner"),
        ),
      );
    if (ownerCount <= 1) {
      return { ok: false, reason: "cannot remove last owner" };
    }
  }

  await db
    .delete(schema.merchantMembers)
    .where(
      and(
        eq(schema.merchantMembers.merchantId, input.merchantId),
        eq(schema.merchantMembers.userId, input.targetUserId),
      ),
    );
  return { ok: true };
}

export interface MemberRow {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  acceptedAt: Date | null;
}

export type ListMembersResult = { ok: true; members: MemberRow[] } | { ok: false; reason: string };

export async function listMembers(input: {
  actorUserId: string;
  merchantId: string;
}): Promise<ListMembersResult> {
  // Anyone in the merchant can see the team list.
  const m = await getMembership(input.actorUserId, input.merchantId);
  if (!m) return { ok: false, reason: "not a member" };

  const db = getDb();
  const rows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      fullName: schema.users.fullName,
      role: schema.merchantMembers.role,
      acceptedAt: schema.merchantMembers.acceptedAt,
    })
    .from(schema.merchantMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.merchantMembers.userId))
    .where(eq(schema.merchantMembers.merchantId, input.merchantId));

  return {
    ok: true,
    members: rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      fullName: r.fullName,
      role: r.role as Role,
      acceptedAt: r.acceptedAt,
    })),
  };
}
```

- [ ] **Step 4: Run tests, verify they PASS**

Run: `pnpm --filter @lapakgram/web test tests/server-actions/members.test.ts`
Expected: 4/4 passing.

- [ ] **Step 5: Wire NextAuth middleware for route guards**

Create `apps/web/middleware.ts`:

```ts
import NextAuth from "next-auth";
import { authConfig } from "./auth.config.js";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

The `authorized` callback in `auth.config.ts` (Task 6) already gates the dashboard. This middleware just runs that callback at the edge before pages render.

- [ ] **Step 6: Build the team settings page**

Create `apps/web/app/(dashboard)/[merchantSlug]/settings/team/page.tsx`:

```tsx
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { createDb, schema } from "@lapakgram/db";
import { listMembers } from "@/lib/server-actions/members";
import { TeamClient } from "./_components/team-client";

interface Props {
  params: Promise<{ merchantSlug: string }>;
}

export default async function TeamPage({ params }: Props) {
  const { merchantSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();

  const db = createDb(process.env.DATABASE_URL!);
  const [merchant] = await db
    .select({ id: schema.merchants.id })
    .from(schema.merchants)
    .where(eq(schema.merchants.slug, merchantSlug))
    .limit(1);
  if (!merchant) notFound();

  const list = await listMembers({ actorUserId: session.user.id, merchantId: merchant.id });
  if (!list.ok) return <p>{list.reason}</p>;

  return (
    <TeamClient merchantId={merchant.id} members={list.members} actorUserId={session.user.id} />
  );
}
```

Create `apps/web/app/(dashboard)/[merchantSlug]/settings/team/_components/team-client.tsx`:

```tsx
"use client";
import { useState } from "react";
import {
  inviteMember,
  changeMemberRole,
  removeMember,
  type MemberRow,
} from "@/lib/server-actions/members";
import type { Role } from "@/lib/permissions";

export function TeamClient({
  merchantId,
  members: initialMembers,
  actorUserId,
}: {
  merchantId: string;
  members: MemberRow[];
  actorUserId: string;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("support");
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold">Team</h1>
        <table className="w-full table-auto rounded bg-white shadow">
          <thead className="bg-slate-100 text-left text-sm">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t text-sm">
                <td className="px-3 py-2">{m.fullName ?? "-"}</td>
                <td className="px-3 py-2">{m.email ?? "-"}</td>
                <td className="px-3 py-2">
                  <select
                    className="rounded border px-2 py-1"
                    value={m.role}
                    disabled={m.userId === actorUserId}
                    onChange={async (e) => {
                      const newRole = e.target.value as Role;
                      const r = await changeMemberRole({
                        actorUserId,
                        merchantId,
                        targetUserId: m.userId,
                        newRole,
                      });
                      if (r.ok) {
                        setMembers((prev) =>
                          prev.map((p) => (p.userId === m.userId ? { ...p, role: newRole } : p)),
                        );
                      }
                    }}
                  >
                    {(["admin", "finance", "support"] as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    {m.role === "owner" ? <option value="owner">owner</option> : null}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  {m.userId !== actorUserId && m.role !== "owner" ? (
                    <button
                      type="button"
                      className="text-sm text-red-600"
                      onClick={async () => {
                        if (!confirm("Hapus member ini?")) return;
                        const r = await removeMember({
                          actorUserId,
                          merchantId,
                          targetUserId: m.userId,
                        });
                        if (r.ok) {
                          setMembers((prev) => prev.filter((p) => p.userId !== m.userId));
                        }
                      }}
                    >
                      Hapus
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Undang anggota baru</h2>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setInviteResult(null);
            const r = await inviteMember({
              actorUserId,
              merchantId,
              email,
              role,
            });
            if (r.ok) {
              setInviteResult(`Invite dikirim ke ${email}. Dev URL: ${r.acceptUrl}`);
              setEmail("");
            } else {
              setInviteResult(`Gagal: ${r.reason}`);
            }
          }}
        >
          <input
            className="flex-1 rounded border px-3 py-2"
            placeholder="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="rounded border px-2 py-2"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {(["admin", "finance", "support"] as Role[]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Undang
          </button>
        </form>
        {inviteResult ? <p className="break-all text-xs text-slate-600">{inviteResult}</p> : null}
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Build the invite acceptance page**

Create `apps/web/app/(auth)/invite/[token]/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { acceptInvite } from "@/lib/server-actions/members";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function AcceptInvitePage({ params }: Props) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }
  const result = await acceptInvite({ userId: session.user.id, token });
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

  const db = createDb(process.env.DATABASE_URL!);
  const [merchant] = await db
    .select({ slug: schema.merchants.slug })
    .from(schema.merchants)
    .where(eq(schema.merchants.id, result.merchantId))
    .limit(1);
  if (!merchant) redirect("/");

  redirect(`/${merchant.slug}`);
}
```

- [ ] **Step 8: Commit**

```
git add apps/web/lib/server-actions/members.ts apps/web/middleware.ts apps/web/app/\(auth\)/invite apps/web/app/\(dashboard\)/\[merchantSlug\]/settings/team apps/web/tests/server-actions/members.test.ts
git commit -m "feat(web): add multi-admin invite flow and team settings page"
```

---

## Task 13: Platform admin merchants list

**Files:**

- Create: `apps/web/app/(admin)/admin/layout.tsx`
- Create: `apps/web/app/(admin)/admin/merchants/page.tsx`

This is the platform owner's view (you, the SaaS provider). Only users where `users.is_platform_admin = true` can access. We'll bootstrap one platform admin manually via a migration helper (one-time op).

- [ ] **Step 1: Create admin layout with platform admin check**

Create `apps/web/app/(admin)/admin/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { createDb, schema } from "@lapakgram/db";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const db = createDb(process.env.DATABASE_URL!);
  const [user] = await db
    .select({ isAdmin: schema.users.isPlatformAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  if (!user?.isAdmin) notFound();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <Link href="/admin" className="font-bold">
          Lapakgram Admin
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/merchants">Merchants</Link>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create merchants list page**

Create `apps/web/app/(admin)/admin/merchants/page.tsx`:

```tsx
import { desc } from "drizzle-orm";
import { createDb, schema } from "@lapakgram/db";

export default async function AdminMerchantsPage() {
  const db = createDb(process.env.DATABASE_URL!);
  const merchants = await db
    .select({
      id: schema.merchants.id,
      slug: schema.merchants.slug,
      name: schema.merchants.name,
      status: schema.merchants.status,
      botUsername: schema.merchants.botUsername,
      createdAt: schema.merchants.createdAt,
    })
    .from(schema.merchants)
    .orderBy(desc(schema.merchants.createdAt));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Merchants ({merchants.length})</h1>
      <table className="w-full table-auto rounded bg-white shadow">
        <thead className="bg-slate-100 text-left text-sm">
          <tr>
            <th className="px-3 py-2">Slug</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Bot</th>
            <th className="px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {merchants.map((m) => (
            <tr key={m.id} className="border-t text-sm">
              <td className="px-3 py-2 font-mono">{m.slug}</td>
              <td className="px-3 py-2">{m.name}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    m.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {m.status}
                </span>
              </td>
              <td className="px-3 py-2">{m.botUsername ? `@${m.botUsername}` : "-"}</td>
              <td className="px-3 py-2">{m.createdAt.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Manual smoke test (requires platform admin user)**

Promote your dev user to platform admin via psql:

```
docker exec lapakgram-postgres psql -U lapakgram -d lapakgram -c "UPDATE users SET is_platform_admin = true WHERE email = 'YOUR_EMAIL';"
```

Then visit http://localhost:3000/admin/merchants — you should see the list. A non-admin user should see a 404.

- [ ] **Step 4: Commit**

```
git add apps/web/app/\(admin\)
git commit -m "feat(web): add platform admin merchants list page"
```

---

## Task 14: End-to-end Playwright smoke test

**Files:**

- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/onboarding.spec.ts`
- Modify: `apps/web/package.json` (add `e2e` script)

Playwright drives a real browser through the full flow: register → verify email → create merchant → setup bot (with mocked Telegram API) → invite teammate → admin accepts.

- [ ] **Step 1: Add Playwright deps**

Run: `pnpm --filter @lapakgram/web add -D @playwright/test`
Then: `pnpm --filter @lapakgram/web exec playwright install --with-deps chromium`

- [ ] **Step 2: Create Playwright config**

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @lapakgram/web dev",
    port: 3000,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: "postgres://lapakgram:lapakgram_dev@localhost:5434/lapakgram_e2e",
      MASTER_ENCRYPTION_KEY:
        process.env.MASTER_ENCRYPTION_KEY ?? "ZGV2X29ubHlfMzJfYnl0ZV9rZXlfZG9fbm90X3VzZSE=",
      INVITE_SIGNING_SECRET:
        process.env.INVITE_SIGNING_SECRET ?? "ZGV2X29ubHlfaW52aXRlX3NpZ25pbmdfa2V5XzMyXyE=",
      NEXTAUTH_SECRET: "e2e_test_secret_minimum_32_bytes_long",
      NEXTAUTH_URL: "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 3: Add e2e script to package.json**

In `apps/web/package.json` scripts block, add:

```
"e2e": "playwright test",
"e2e:setup": "tsx ./e2e/_setup-db.ts"
```

(If `tsx` isn't installed, run `pnpm --filter @lapakgram/web add -D tsx`.)

- [ ] **Step 4: Create e2e DB setup helper**

Create `apps/web/e2e/_setup-db.ts`:

```ts
import { ensureTestDb } from "../tests/_helpers/db.js";

await ensureTestDb("lapakgram_e2e");
console.log("E2E DB ready");
```

- [ ] **Step 5: Write the E2E spec**

Create `apps/web/e2e/onboarding.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Mock Telegram API by intercepting outbound calls.
test.beforeEach(async ({ page }) => {
  await page.route("https://api.telegram.org/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/getMe")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: {
            id: 1234567890,
            is_bot: true,
            username: "lapakgram_e2e_bot",
            first_name: "E2E Bot",
          },
        }),
      });
      return;
    }
    if (url.includes("/setWebhook")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, description: "Webhook was set" }),
      });
      return;
    }
    await route.fulfill({ status: 200, body: "{}" });
  });
});

test("merchant onboarding end-to-end", async ({ page, baseURL }) => {
  const ts = Date.now();
  const ownerEmail = `owner+${ts}@example.com`;
  const ownerPassword = "password123";

  // 1. Register
  await page.goto("/register");
  await page.fill("input[placeholder='Nama lengkap']", "E2E Owner");
  await page.fill("input[placeholder='Email']", ownerEmail);
  await page.fill("input[placeholder='Password (min 8)']", ownerPassword);
  await page.click("button[type=submit]");
  await expect(page.getByText("Registrasi berhasil")).toBeVisible();

  // 2. Verify email via dev link in the page
  const devLink = page.getByRole("link", { name: /verify-email\?token=/ });
  await devLink.click();
  await expect(page.getByText("Email diverifikasi")).toBeVisible();

  // 3. Login
  await page.goto("/login");
  await page.fill("input[placeholder='Email']", ownerEmail);
  await page.fill("input[placeholder='Password']", ownerPassword);
  await page.click("button[type=submit]");
  await page.waitForURL("**/new-merchant");

  // 4. Create merchant
  const slug = `e2e-shop-${ts}`;
  await page.fill("input[placeholder='Nama toko']", "E2E Shop");
  await page.fill("input[placeholder^='slug-toko']", slug);
  await page.click("button[type=submit]");
  await page.waitForURL(`**/${slug}/settings/bot`);

  // 5. Setup bot (Telegram API mocked above)
  await page.fill("input[placeholder^='123456']", "1234567890:AAH-FAKE-TOKEN-AT-LEAST-30-CHARS");
  await page.click("button[type=submit]");
  await expect(page.getByText("Bot @lapakgram_e2e_bot terhubung")).toBeVisible();
  await page.waitForURL(`**/${slug}`, { timeout: 5000 });

  // 6. Invite a teammate
  const teammateEmail = `team+${ts}@example.com`;
  await page.goto(`${baseURL}/${slug}/settings/team`);
  await page.fill("input[type=email]", teammateEmail);
  await page.selectOption("select", "support");
  await page.click("button:has-text('Undang')");
  // Wait for the dev URL to appear in the result hint
  const inviteHint = page.getByText(/Invite dikirim/);
  await expect(inviteHint).toBeVisible();
  const hintText = await inviteHint.innerText();
  const inviteUrlMatch = hintText.match(/https?:\/\/\S+\/invite\/[^\s]+/);
  expect(inviteUrlMatch).toBeTruthy();
  const inviteUrl = inviteUrlMatch![0]!;

  // 7. Open new context (incognito-like) for the teammate
  const teammateContext = await page.context().browser()!.newContext();
  const teammatePage = await teammateContext.newPage();

  // Register the teammate (separate session)
  await teammatePage.goto(`${baseURL}/register`);
  await teammatePage.fill("input[placeholder='Email']", teammateEmail);
  await teammatePage.fill("input[placeholder='Password (min 8)']", "password123");
  await teammatePage.click("button[type=submit]");
  await expect(teammatePage.getByText("Registrasi berhasil")).toBeVisible();
  const teammateVerifyLink = teammatePage.getByRole("link", { name: /verify-email\?token=/ });
  await teammateVerifyLink.click();
  await expect(teammatePage.getByText("Email diverifikasi")).toBeVisible();

  // Login as teammate
  await teammatePage.goto(`${baseURL}/login`);
  await teammatePage.fill("input[placeholder='Email']", teammateEmail);
  await teammatePage.fill("input[placeholder='Password']", "password123");
  await teammatePage.click("button[type=submit]");
  await teammatePage.waitForURL("**/new-merchant");

  // Visit invite URL
  await teammatePage.goto(inviteUrl);
  await teammatePage.waitForURL(`**/${slug}`);

  await teammateContext.close();

  // 8. Owner now sees the teammate in the team list
  await page.reload();
  await expect(page.getByText(teammateEmail)).toBeVisible();
});
```

- [ ] **Step 6: Run the E2E**

Make sure docker stack is up. Bootstrap E2E DB:

```
pnpm --filter @lapakgram/web e2e:setup
```

Then run the test (Playwright auto-starts the dev server):

```
pnpm --filter @lapakgram/web e2e
```

Expected: 1 test passes (~30-60s on first run).

- [ ] **Step 7: Commit**

```
git add apps/web/playwright.config.ts apps/web/e2e apps/web/package.json pnpm-lock.yaml
git commit -m "test(web): add Playwright E2E for full onboarding flow"
```

---

## Plan Self-Review

**Spec coverage:**

The Plan 1 design spec (§5.1 §5.5) covered RLS and encryption. Plan 2 covers spec sections:

- §6 Data Model — adds email_verifications and merchant_invites tables (Task 1)
- §7.1-7.3 Auth Strategy — NextAuth Credentials + Telegram providers (Tasks 2, 3, 6, 7, 8)
- §7.4 RBAC — permissions matrix + middleware (Tasks 5, 12)
- §8.1 Merchant Onboarding flow — create merchant + bot wizard (Tasks 9, 10)
- §8.4 Member invites — invite/accept (Task 12)
- Platform admin panel — first slice (Task 13)
- Verification — encryption test, RLS test, isolation test, server action tests, E2E (Tasks 2-12)

Items deferred to Plan 3+:

- Mini App routes (Plan 3)
- Bot service Go (Plan 3)
- Catalog (Plan 3)
- Order/payment (Plan 4)
- Saldo/payout (Plan 5)

No spec items from Plan 2 scope are missed.

**Placeholder scan:** All steps have full code or commands. No "TBD"/"TODO" placeholders.

**Type consistency:**

- `Role` and `Permission` types defined in Task 5 are used consistently in Tasks 6 (NextAuth session callback), 12 (server actions, team UI)
- `setupBotForMerchant` returns `{ ok: true, botUsername, botId }` — the page in Task 10 step 6 reads `result.botUsername`
- `merchant_invites.tokenHash` SHA-256 form is consistent between schema (Task 1), invite-token util (Task 4), and server actions (Task 12)
- Test DB helper `ensureTestDb` in Task 7 is reused by Task 14 e2e setup

**Gaps:**

- Task 7 server actions test references `process.env.DATABASE_URL`, set by Task 7 step 4 setup helper. `tests/_helpers/setup.ts` runs before each test file and points DATABASE_URL at the test DB.
- Task 12 tests reuse the same DB; we accept that the data accumulates across tests within one test file. Each test creates a fresh user/merchant so isolation is by ID, not by truncation. This keeps tests fast.

**Outcome verification:**

After all 14 tasks, run:

```
pnpm install
pnpm dev:up
pnpm db:migrate
pnpm test
pnpm --filter @lapakgram/web e2e:setup
pnpm --filter @lapakgram/web e2e
```

Expected:

- `pnpm test` runs all unit + integration tests (existing 17 + ~25 new), all green
- `pnpm e2e` runs the full onboarding spec, green
- Manual: `pnpm --filter @lapakgram/web dev`, register a user, verify, create merchant, setup bot with a real BotFather token, send `/start` to the bot — receive the stub welcome message

Plan 2 closes when all of the above pass.
