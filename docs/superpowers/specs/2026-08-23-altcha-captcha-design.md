# Altcha CAPTCHA Swap — Design

**Date:** 2026-08-23
**Status:** Draft (approved: self-hosted proof-of-work)

## Goal
Replace hCaptcha with **Altcha** (self-hosted proof-of-work) on the public enrollment form + ingest endpoint. No external CAPTCHA service, no accounts, one server-only secret.

## Decision
Self-hosted proof-of-work via `altcha-lib` (classic v1 API) + the `altcha` widget web component. Both MIT. Verification is stateless (HMAC-signed challenges) — the outbound call to `hcaptcha.com` disappears. Replay is mitigated by short challenge expiry + the existing ingest dedupe.

## Architecture
1. **Challenge endpoint** `GET /api/altcha/challenge` → `createChallenge({ hmacKey: ALTCHA_HMAC_KEY, maxNumber, expires })`, `Cache-Control: no-store`.
2. **Widget** `<altcha-widget challengeurl="/api/altcha/challenge" name="captcha_token">` on the form's final step; on solve it writes the base64 payload into a hidden `captcha_token` field (keeping the existing ingest field name).
3. **Server verify** `verifyCaptcha(payload)` → `verifySolution(payload, ALTCHA_HMAC_KEY, true)` (checkExpires). Keeps the existing `(payload) => Promise<boolean>` contract, fails closed.

## Env changes
- **Remove:** `HCAPTCHA_SECRET`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`.
- **Add:** `ALTCHA_HMAC_KEY` (server-only, `z.string().min(1)`; generate via `openssl rand -hex 32`).
- **Add:** `NEXT_PUBLIC_CAPTCHA_ENABLED` (optional; `'true'` enables the widget + ingest enforcement) — replaces the old `if (env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY)` gate so CAPTCHA can be toggled without a site key.

## Files
- `src/lib/env.ts` — env swap.
- `.env.example` / `.env.local` — env swap (`ALTCHA_HMAC_KEY`, `NEXT_PUBLIC_CAPTCHA_ENABLED`).
- Create `src/app/api/altcha/challenge/route.ts` — challenge endpoint (runtime nodejs).
- `src/features/ingest/captcha.ts` — rewrite `verifyCaptcha` to use `verifySolution`.
- `src/app/api/ingest/route.ts` — gate on `NEXT_PUBLIC_CAPTCHA_ENABLED` instead of the site key; field stays `captcha_token`.
- `src/app/f/[slug]/FormRunner.tsx` — remove the hCaptcha script loader / `window.hcaptcha` render logic; add `import 'altcha'` + `<altcha-widget>`; capture the payload into `captchaToken`. Replace the `hcaptchaSiteKey: string` prop with `captchaEnabled: boolean`.
- `src/app/f/[slug]/page.tsx` — pass `captchaEnabled={env.NEXT_PUBLIC_CAPTCHA_ENABLED === 'true'}` instead of the site key.
- Add a JSX type declaration for the `altcha-widget` custom element.
- `package.json` — `npm i altcha altcha-lib`; remove any hCaptcha dep (none — code used raw `window.hcaptcha`).

## Testing
- `src/features/ingest/captcha.test.ts` — empty/null → false; a real `createChallenge` → `solveChallenge` → `verifySolution` round-trip → true; tampered payload → false; wrong-key → false. (`altcha-lib` exports `solveChallenge` for tests.)

## Security / gotchas
- `ALTCHA_HMAC_KEY` is server-only (never `NEXT_PUBLIC`). No site key needed client-side (the widget only needs the challenge URL).
- `verifySolution` confirms the challenge was one we issued (HMAC) — stateless, no challenge store.
- Short `expires` (10 min) + `checkExpires:true`; existing per-submission dedupe covers replay within that window.
- CSP (none set today): if added later, allow `worker-src 'self' blob:` + same-origin `connect-src` for the widget's workers/challenge fetch. No iframes, so `frame-ancestors` is unaffected. The hCaptcha `script-src` allowance is no longer needed.
- Fails closed on any error (unchanged behaviour).

## ENV-PENDING
Set `ALTCHA_HMAC_KEY` in Railway + `.env.local`; set `NEXT_PUBLIC_CAPTCHA_ENABLED=true` to enforce. Manual: load the form → widget solves → submit succeeds; tamper/omit `captcha_token` → ingest 400.
