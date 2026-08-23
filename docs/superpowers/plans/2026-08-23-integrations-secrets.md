# Integrations & Secrets (Spec A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin `Settings → Integrations` page to manage Razorpay + AiSensy secrets (encrypted, write-only, DB-overrides-env) and view/set/test their inbound webhooks.

**Architecture:** New `integration_settings` table stores AES-256-GCM-encrypted secret values (RLS deny-all, service-role only). A `getSecret()` resolver returns the decrypted DB value or falls back to the env var. All provider code switches from `getEnv().RAZORPAY_*`/`AISENSY_*` to `getSecret(...)`. One master `ENCRYPTION_KEY` stays in env.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, node:crypto (AES-256-GCM), Supabase service-role, Zod, Vitest.

## Global Constraints
- Secrets never returned to the client — status is boolean + source only. Plaintext lives only server-side.
- `ENCRYPTION_KEY` (32-byte hex) server-only, required. Provider vars (`RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET`, `AISENSY_API_KEY/WEBHOOK_SECRET`) become `.optional()` in env (may live only in DB).
- All new DB tables RLS deny-all; access via `getServiceClient()` in `server-only` modules.
- Mutations assert `requirePermission('settings','edit')`; status reads assert `settings.view` (or run under the settings-gated layout).
- Design tokens (Inter, dark-default, `--accent:#ff4500`, CSS vars); match the Stages/Roles editors.
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test`). Never run `npm run dev` in a gate. Migrations applied out-of-band; build stays green without them.

## File Structure
- Create: `supabase/migrations/0009_integration_settings.sql`
- Modify: `src/lib/env.ts` (ENCRYPTION_KEY required; provider vars optional), `.env.example`
- Create: `src/features/integrations/crypto.ts` (+ `.test.ts`), `secrets.ts` (+ `.test.ts`), `actions.ts`, `queries.ts`, `schema.ts`
- Modify: `src/features/razorpay/client.ts`, `src/app/api/webhooks/razorpay/route.ts`, `src/features/aisensy/send.ts`, `src/app/api/webhooks/aisensy/route.ts` (use `getSecret`)
- Create: `src/lib/supabase/types.ts` addition (`IntegrationSetting`, `SecretKey`)
- Create: `src/app/admin/settings/integrations/{page.tsx, IntegrationsEditor.tsx}`; modify `SettingsNav.tsx`

---

## Workstream 1: db + crypto

### Task 1.1: Migration + env + types
**Files:** Create `supabase/migrations/0009_integration_settings.sql`; Modify `src/lib/env.ts`, `.env.example`, `src/lib/supabase/types.ts`

- [ ] **Step 1: Migration** (verbatim):
```sql
-- 0009_integration_settings.sql — encrypted provider secrets (Spec A). Apply out-of-band.
create table if not exists integration_settings (
  key        text primary key,
  value_enc  text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table integration_settings enable row level security;
```
- [ ] **Step 2: env.ts** — add `ENCRYPTION_KEY: z.string().min(32)`; change `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `AISENSY_API_KEY`, `AISENSY_WEBHOOK_SECRET` to `.optional()`.
- [ ] **Step 3: .env.example** — add `ENCRYPTION_KEY=` (note: `openssl rand -hex 32`).
- [ ] **Step 4: types.ts** — add:
```ts
export type SecretKey =
  | 'RAZORPAY_KEY_ID' | 'RAZORPAY_KEY_SECRET' | 'RAZORPAY_WEBHOOK_SECRET'
  | 'AISENSY_API_KEY' | 'AISENSY_WEBHOOK_SECRET'
export interface IntegrationSetting { key: SecretKey; value_enc: string; updated_at: string; updated_by: string | null }
```
- [ ] **Step 5: Gates** — lint + type-check + build. **Commit** — `feat(db): integration_settings table + ENCRYPTION_KEY env`

### Task 1.2: Crypto helper (TDD)
**Files:** Create `src/features/integrations/crypto.ts`, `src/features/integrations/crypto.test.ts`
**Interfaces:** Produces `encryptSecret(plain: string): string`, `decryptSecret(enc: string): string`.

- [ ] **Step 1: Test** `crypto.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/env', () => ({ getEnv: () => ({ ENCRYPTION_KEY: 'a'.repeat(64) }) })) // 32 bytes hex
import { encryptSecret, decryptSecret } from './crypto'
describe('secret crypto', () => {
  it('round-trips', () => { const c = encryptSecret('sk_live_123'); expect(c).not.toContain('sk_live_123'); expect(decryptSecret(c)).toBe('sk_live_123') })
  it('unique ciphertext per call (random IV)', () => { expect(encryptSecret('x')).not.toBe(encryptSecret('x')) })
  it('tampered ciphertext throws', () => { const c = encryptSecret('y'); const bad = c.slice(0, -2) + (c.endsWith('a') ? 'b' : 'a'); expect(() => decryptSecret(bad)).toThrow() })
})
```
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement crypto.ts** — `import 'server-only'`; AES-256-GCM; key = `Buffer.from(getEnv().ENCRYPTION_KEY, 'hex')` (must be 32 bytes); `encryptSecret`: random 12-byte IV, `createCipheriv('aes-256-gcm', key, iv)`, output `${iv.toString('base64')}:${authTag.toString('base64')}:${enc.toString('base64')}`; `decryptSecret`: split, `createDecipheriv`, `setAuthTag`, decrypt (throws on auth failure).
- [ ] **Step 4: Run — PASS.** **Gates + Commit** — `feat(integrations): AES-256-GCM secret crypto + tests`

---

## Workstream 2: resolver + provider wiring

### Task 2.1: getSecret resolver (TDD)
**Files:** Create `src/features/integrations/secrets.ts`, `src/features/integrations/secrets.test.ts`
**Interfaces:** Consumes `decryptSecret`, `getServiceClient`, `getEnv`. Produces `getSecret(key: SecretKey): Promise<string | undefined>` (DB decrypted value, else env value, else undefined).

- [ ] **Step 1: Test** (mock service client + env + crypto): DB row present → returns `decryptSecret(value_enc)`; DB absent → returns `getEnv()[key]`; both absent → `undefined`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — `server-only`; select `value_enc` from `integration_settings` where `key=key` via service client `.maybeSingle()`; if row → `decryptSecret`; else `getEnv()[key]`. Swallow a decrypt/DB error by falling back to env (log server-side).
- [ ] **Step 4: Run — PASS.** **Gates + Commit** — `feat(integrations): getSecret resolver (DB override, env fallback) + tests`

### Task 2.2: Switch provider code to getSecret
**Files:** Modify `src/features/razorpay/client.ts`, `src/app/api/webhooks/razorpay/route.ts`, `src/features/aisensy/send.ts`, `src/app/api/webhooks/aisensy/route.ts`
- [ ] **Step 1:** `razorpay/client.ts` — replace `env.RAZORPAY_KEY_ID/SECRET` with `await getSecret('RAZORPAY_KEY_ID')` / `...SECRET`; make the client factory async if needed (and its callers await). If a required secret resolves undefined, throw a clear error.
- [ ] **Step 2:** `webhooks/razorpay/route.ts` — verify with `await getSecret('RAZORPAY_WEBHOOK_SECRET')` (503 when unset, mirroring the AiSensy pattern).
- [ ] **Step 3:** `aisensy/send.ts` — `apiKey: await getSecret('AISENSY_API_KEY')`; if unset, the send fails-soft (logs, returns not-sent) as today.
- [ ] **Step 4:** `webhooks/aisensy/route.ts` — verify with `await getSecret('AISENSY_WEBHOOK_SECRET')` (keep the existing 503-when-unset guard, now checking the resolved value).
- [ ] **Step 5: Gates** (lint + type-check + build + test — existing razorpay/aisensy tests must stay green; update mocks to mock `getSecret` where they mocked `getEnv`). **Commit** — `feat(integrations): resolve provider secrets via getSecret`

---

## Workstream 3: actions + queries

### Task 3.1: schema + status/set/clear + test actions
**Files:** Create `src/features/integrations/schema.ts`, `actions.ts`, `queries.ts`
**Interfaces:** Produces `getIntegrationStatus(): Promise<{key:SecretKey; isSet:boolean; source:'db'|'env'|'none'; updatedAt:string|null}[]>`; `setSecret(key, value): ActionResult<void>`; `clearSecret(key): ActionResult<void>`; `testRazorpay(): ActionResult<void>`; `testAiSensy(): ActionResult<void>`.
- [ ] **Step 1: schema.ts** — `secretInputSchema = z.object({ key: z.enum([...5 keys]), value: z.string().min(1) })`.
- [ ] **Step 2: queries.ts** (`server-only`) — `getIntegrationStatus`: for each `SecretKey`, check `integration_settings` (db) then `getEnv()` (env) → source + isSet + updatedAt. Never returns values.
- [ ] **Step 3: actions.ts** (`'use server'`) — `setSecret`: `requirePermission('settings','edit')`; validate; `encryptSecret(value)`; upsert `{key, value_enc, updated_at, updated_by: ctx.user.id}` onConflict key; revalidate `/admin/settings/integrations`. `clearSecret`: gated; delete the row; revalidate. `testRazorpay`: resolve keys via getSecret; do a minimal authenticated GET to the Razorpay API; return ok/{error} (no secret in error). `testAiSensy`: resolve API key; a lightweight validation; return ok/{error}.
- [ ] **Step 4: Gates + Commit** — `feat(integrations): status, set/clear secret, test-connection actions`

---

## Workstream 4: UI

### Task 4.1: Integrations settings page
**Files:** Create `src/app/admin/settings/integrations/page.tsx`, `IntegrationsEditor.tsx`; Modify `src/app/admin/settings/SettingsNav.tsx`
**Interfaces:** Consumes `getIntegrationStatus`, `setSecret`, `clearSecret`, `testRazorpay`, `testAiSensy`; `NEXT_PUBLIC_APP_URL` for webhook URLs.
- [ ] **Step 1: SettingsNav** — add settings-gated **Integrations** tab.
- [ ] **Step 2: page.tsx** — `force-dynamic`, `requireModuleView('settings')`, load `getIntegrationStatus()`, render `<IntegrationsEditor status=... appUrl=... />`.
- [ ] **Step 3: IntegrationsEditor** (client) — a card per provider (Razorpay, AiSensy). Per secret: status chip (**Set (DB)** / **Set (env)** / **Not set**), a password input + **Save** (calls `setSecret`) + **Clear** (calls `clearSecret`), inline `role="alert"` errors, `isPending`. A Webhooks block per provider: the URL `${appUrl}/api/webhooks/razorpay` (and `/aisensy`) with a **Copy** button, the webhook-secret field (same pattern), and a **Test** button calling `testRazorpay`/`testAiSensy` showing a green/red result.
- [ ] **Step 4: Gates + Commit** — `feat(integrations): Settings → Integrations UI`

---

## Self-Review Notes
- Spec coverage: table+crypto (WS1), resolver+wiring (WS2), actions incl. test-connection (WS3), UI incl. webhook URL/secret/Test (WS4). All spec sections covered.
- Type consistency: `SecretKey` union, `getSecret`, `encryptSecret/decryptSecret`, `getIntegrationStatus` shape identical across WS.
- Security: values never returned to client (status booleans only); ENCRYPTION_KEY server-only; RLS deny-all; mutations gated by settings.edit.
- Env fallback preserved so nothing breaks pre-migration / pre-key-entry.
- ENV-PENDING: set ENCRYPTION_KEY (Railway + .env.local); live Test needs real provider creds; apply 0009.
