# Spec A — Integrations & Secrets — Design

**Date:** 2026-08-23
**Status:** Draft (awaiting review)

## Goal
An admin **Settings → Integrations** page to manage Razorpay + AiSensy credentials and their inbound webhooks from the UI, instead of only via Railway env vars. Secrets are stored encrypted at rest, never shown back to the browser, and **override the env var when set** (env remains a fallback so nothing breaks).

## Decisions (locked 2026-08-23)
- **Storage:** DB-backed, **encrypted at rest** (app-level AES-256-GCM), **write-only in the UI** (masked "set / not set", never echoed), **DB overrides env, env is fallback**.
- **Webhooks (this spec):** inbound only — the page **displays** each webhook URL to register in the provider dashboard, lets you **set its signing secret**, and offers a **Test** button. (Outbound event webhooks are Spec B.)
- **Master key:** a single `ENCRYPTION_KEY` (32-byte hex) stays in env — the one root secret; everything else moves to the encrypted store.

## Managed secrets
Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
AiSensy: `AISENSY_API_KEY`, `AISENSY_WEBHOOK_SECRET`.
(These are the keys currently read in `src/features/razorpay/client.ts`, `src/app/api/webhooks/razorpay/route.ts`, `src/features/aisensy/send.ts`, and the AiSensy webhook route.)

## Data model
New migration `0009_integration_settings.sql`:
```sql
create table integration_settings (
  key         text primary key,          -- e.g. 'RAZORPAY_KEY_SECRET'
  value_enc   text not null,             -- AES-256-GCM ciphertext (iv:tag:data, base64)
  updated_at  timestamptz not null default now(),
  updated_by  uuid                       -- auth user id
);
alter table integration_settings enable row level security;  -- deny-all; service-role only
```
Only secret *values* live here (encrypted). Non-secret display data (webhook URLs) is derived from `NEXT_PUBLIC_APP_URL`, not stored.

## Crypto (`src/features/integrations/crypto.ts`)
- `encryptSecret(plain: string): string` — AES-256-GCM with a random 12-byte IV, key = `ENCRYPTION_KEY` (hex→32 bytes); output `base64(iv).base64(tag).base64(ciphertext)`.
- `decryptSecret(enc: string): string` — inverse; throws on tamper (GCM auth).
- Pure, unit-tested (round-trip, tamper-detection, wrong-key failure). `server-only`.

## Secret resolver (`src/features/integrations/secrets.ts`)
- `getSecret(key: SecretKey): Promise<string>` — read `integration_settings` for `key`; if present, `decryptSecret`; else fall back to `getEnv()[key]`. `server-only`, service-role client.
- All provider code switches from `getEnv().RAZORPAY_*` / `AISENSY_*` to `await getSecret('...')`. The env schema keeps these as **optional** (they may live only in the DB now).
- `env.ts`: make `RAZORPAY_*` + `AISENSY_*` `.optional()` (they can be unset in env if set in DB). `ENCRYPTION_KEY` added as required.

## Server actions + queries (`src/features/integrations/`)
- `getIntegrationStatus(): Promise<{ key, isSet, source: 'db'|'env'|'none', updatedAt }[]>` — masked status only, never the value. `settings.view` gated.
- `setSecret(key, value)` — `requirePermission('settings','edit')`; validate non-empty; `encryptSecret` + upsert; stamp `updated_by`; revalidate.
- `clearSecret(key)` — remove the DB row (reverts to env fallback).
- `testRazorpay()` — resolve keys, do a minimal authenticated Razorpay API call (e.g. fetch payment methods / a lightweight GET), return ok/err (no secret in the response).
- `testAiSensy()` — resolve key; a lightweight validation call or a dry check; return ok/err.

## UI (`/admin/settings/integrations`)
- Settings sub-nav gains **Integrations** (settings-gated).
- One card per provider. Each secret field: a masked status chip (**Set** / **Not set**, and whether from **DB** or **env**), a password-type input to set/replace (never pre-filled), a **Save** button, and a **Clear** (revert to env) link.
- A **Webhooks** section per provider: the URL to register (`{NEXT_PUBLIC_APP_URL}/api/webhooks/razorpay`, `.../aisensy`) with a copy button, the signing-secret field (same masked pattern), and a **Test** button that pings the endpoint / does the provider check.
- Design system tokens; matches the Stages/Roles editors.

## Security
- `ENCRYPTION_KEY` server-only; ciphertext never leaves the server; the plaintext secret is never returned to the client (status is boolean/source only).
- `integration_settings` RLS deny-all; all access via service-role in server-only modules.
- `setSecret`/`clearSecret` gated by `requirePermission('settings','edit')`; status read gated by `settings.view`.
- Test actions must not echo secrets in errors.

## Testing
- crypto: encrypt→decrypt round-trip; tampered ciphertext throws; wrong key fails. (unit)
- secrets resolver: DB present → decrypted value; DB absent → env fallback; neither → throws/empty per contract. (unit, mocked client)
- Gates: `npm run lint && npm run type-check && npm run build` (+ `npm run test`).

## ENV-PENDING
Set `ENCRYPTION_KEY` in Railway + `.env.local`. Live Test buttons need real Razorpay/AiSensy creds (entered via the new UI or env). Manual: set a Razorpay secret in the UI → Test → green; register the shown webhook URL in Razorpay → a real `payment_link.paid` verifies against the DB-stored webhook secret.

## Workstreams
1. **db + crypto** — migration 0009, `ENCRYPTION_KEY` env (+ make provider vars optional), crypto helper + tests.
2. **resolver + wiring** — `getSecret`; switch Razorpay client, Razorpay webhook verify, AiSensy send, AiSensy webhook verify to `getSecret`; resolver tests.
3. **actions + queries** — status/set/clear + testRazorpay/testAiSensy.
4. **UI** — Settings → Integrations page.
