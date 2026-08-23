# Altcha CAPTCHA Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace hCaptcha with self-hosted Altcha (proof-of-work) on the public form + ingest endpoint.

**Architecture:** `altcha-lib` (classic v1 API) server-side (challenge endpoint + `verifySolution`), `altcha` widget client-side. One server-only secret `ALTCHA_HMAC_KEY`; drops both hCaptcha env vars. Stateless verification — no external call. See `docs/superpowers/specs/2026-08-23-altcha-captcha-design.md`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, altcha + altcha-lib, Zod, Vitest.

## Global Constraints
- `ALTCHA_HMAC_KEY` is server-only (never NEXT_PUBLIC). `verifyCaptcha` keeps its `(payload)=>Promise<boolean>` shape and fails closed.
- Ingest field stays `captcha_token` (widget `name="captcha_token"`) — minimize churn.
- Gate CAPTCHA on `NEXT_PUBLIC_CAPTCHA_ENABLED === 'true'` (replaces the site-key gate).
- Design system: Inter, dark-default tokens, --accent #ff4500, CSS vars.
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test` where tests exist). Never run `npm run dev` in a gate.
- No migration (env + code only).

## File Structure
- Modify: `src/lib/env.ts`, `.env.example`, `src/features/ingest/captcha.ts`, `src/app/api/ingest/route.ts`, `src/app/f/[slug]/FormRunner.tsx`, `src/app/f/[slug]/page.tsx`, `package.json`.
- Create: `src/app/api/altcha/challenge/route.ts`, `src/features/ingest/captcha.test.ts`, a JSX typing for `altcha-widget` (e.g. `src/types/altcha.d.ts`).

---

## Workstream 1: server (deps, env, challenge endpoint, verify + test)

### Task 1.1: Deps + env
- [ ] **Step 1:** `npm i altcha altcha-lib` (adds both to package.json).
- [ ] **Step 2:** `src/lib/env.ts` — remove `HCAPTCHA_SECRET` and `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`; add `ALTCHA_HMAC_KEY: z.string().min(1)` and `NEXT_PUBLIC_CAPTCHA_ENABLED: z.string().optional()`.
- [ ] **Step 3:** `.env.example` — replace the two `HCAPTCHA_*` lines with `ALTCHA_HMAC_KEY=` and `NEXT_PUBLIC_CAPTCHA_ENABLED=`.
- [ ] **Step 4: Gate** — lint + type-check (build will fail until captcha.ts is updated in 1.2/1.3; run full gates at the end of 1.3).
- [ ] **Step 5: Commit** — `git commit -am "chore(captcha): add altcha deps + env, drop hcaptcha env"`

### Task 1.2: Challenge endpoint
- [ ] **Step 1:** Create `src/app/api/altcha/challenge/route.ts`:
```ts
import { createChallenge } from 'altcha-lib/v1'
import { getEnv } from '@/lib/env'

export const runtime = 'nodejs'

export async function GET() {
  const challenge = await createChallenge({
    hmacKey: getEnv().ALTCHA_HMAC_KEY,
    maxNumber: 100_000,
    expires: new Date(Date.now() + 10 * 60_000),
  })
  return Response.json(challenge, { headers: { 'Cache-Control': 'no-store' } })
}
```
- [ ] **Step 2: Commit** — `git commit -am "feat(captcha): altcha challenge endpoint"`

### Task 1.3: verifyCaptcha rewrite + tests
- [ ] **Step 1: Write the test** `src/features/ingest/captcha.test.ts` (uses a fixed key; real round-trip via `createChallenge` + `solveChallenge` from `altcha-lib/v1`):
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/env', () => ({ getEnv: () => ({ ALTCHA_HMAC_KEY: 'test-key-123' }) }))
import { createChallenge, solveChallenge } from 'altcha-lib/v1'
import { verifyCaptcha } from './captcha'

async function solvedPayload(key: string) {
  const ch = await createChallenge({ hmacKey: key, maxNumber: 1000 })
  const sol = await solveChallenge(ch.challenge, ch.salt, ch.algorithm, ch.maxnumber).promise
  const payload = { algorithm: ch.algorithm, challenge: ch.challenge, number: sol!.number, salt: ch.salt, signature: ch.signature }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

describe('verifyCaptcha (altcha)', () => {
  it('empty → false', async () => { expect(await verifyCaptcha('')).toBe(false); expect(await verifyCaptcha(null)).toBe(false) })
  it('valid solved payload → true', async () => { expect(await verifyCaptcha(await solvedPayload('test-key-123'))).toBe(true) })
  it('garbage payload → false', async () => { expect(await verifyCaptcha('not-base64-!!')).toBe(false) })
})
```
- [ ] **Step 2: Run — expect FAIL** (verifyCaptcha still calls hCaptcha).
- [ ] **Step 3: Rewrite `src/features/ingest/captcha.ts`** to:
```ts
import 'server-only'
import { verifySolution } from 'altcha-lib/v1'
import { getEnv } from '@/lib/env'

/** Verify an Altcha proof-of-work payload. Fails closed. */
export async function verifyCaptcha(payload: string | null | undefined): Promise<boolean> {
  if (!payload) return false
  try {
    return await verifySolution(payload, getEnv().ALTCHA_HMAC_KEY, true)
  } catch {
    return false
  }
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5:** `src/app/api/ingest/route.ts` — change the gate `if (env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY)` to `if (env.NEXT_PUBLIC_CAPTCHA_ENABLED === 'true')`. Field name `captcha_token` unchanged.
- [ ] **Step 6: Gates** — lint + type-check + build + test
- [ ] **Step 7: Commit** — `git commit -am "feat(captcha): verify altcha solutions server-side; gate on NEXT_PUBLIC_CAPTCHA_ENABLED"`

---

## Workstream 2: client (widget swap in FormRunner + page)

### Task 2.1: altcha-widget JSX typing
- [ ] **Step 1:** Create `src/types/altcha.d.ts` declaring the `altcha-widget` custom element for JSX:
```ts
import type React from 'react'
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'altcha-widget': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { challengeurl?: string; name?: string; auto?: string },
        HTMLElement
      >
    }
  }
}
```
(If the project's React/Next JSX namespace differs, adapt so `<altcha-widget>` type-checks. Verify with `npm run type-check`.)
- [ ] **Step 2: Commit** — `git commit -am "chore(captcha): altcha-widget JSX typing"`

### Task 2.2: FormRunner + page swap
- [ ] **Step 1: `src/app/f/[slug]/FormRunner.tsx`** — remove the hCaptcha integration: `HCAPTCHA_SRC`, the `HCaptchaApi`/`window.hcaptcha`/`onHCaptchaLoad` declarations, `renderCaptcha`, `captchaWidgetId`, `captchaRef`, the script-load `useEffect`, and any reset call. Replace the `hcaptchaSiteKey: string` prop with `captchaEnabled: boolean`; set `captchaRequired = captchaEnabled`. Add `import 'altcha'` at module top. On the final step, when `captchaRequired`, render `<altcha-widget challengeurl="/api/altcha/challenge" name="captcha_token" />` inside a ref'd container and capture the solved payload into `captchaToken` — read it from the hidden input the widget writes (`name="captcha_token"`) on submit, or listen to the widget's `statechange`/`verified` event and `setCaptchaToken(payload)`. Keep POSTing `captcha_token`. Submit remains gated on `!captchaRequired || captchaToken`.
- [ ] **Step 2: `src/app/f/[slug]/page.tsx`** — replace the `HCAPTCHA_SITE_KEY` prop/comment; pass `captchaEnabled={getEnv().NEXT_PUBLIC_CAPTCHA_ENABLED === 'true'}` (or read the public env appropriately) to `<FormRunner>`.
- [ ] **Step 3: Gates** — lint + type-check + build
- [ ] **Step 4: Commit** — `git commit -am "feat(captcha): render altcha-widget on the public form (replaces hCaptcha)"`

---

## Self-Review Notes
- `verifyCaptcha` keeps its boolean/fail-closed contract → ingest step-2 logic unchanged except the enable gate.
- Field name `captcha_token` preserved → no ingest parsing change.
- Secret is server-only; widget needs only the challenge URL. No site key in the client.
- Round-trip test proves a solved payload verifies and a tampered one fails.
- ENV-PENDING: set `ALTCHA_HMAC_KEY` + `NEXT_PUBLIC_CAPTCHA_ENABLED=true` (Railway + .env.local); browser widget solve is verifiable live.
