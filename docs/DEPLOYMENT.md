# Deployment Runbook — Molecule Enrollment CRM (Railway + Supabase)

The app is code-complete. This is the last mile: config only, no building.

## Prerequisites
- GitHub repo `dhiraj898/moladus-crm` (done).
- Supabase project (done) with **migrations 0001–0010 already applied**.
- A [Railway](https://railway.app) account.

---

## 1. Deploy the web app to Railway
1. Railway → **New Project → Deploy from GitHub repo** → select `dhiraj898/moladus-crm`, branch `main`.
2. Railway auto-detects Next.js (Nixpacks). `railway.json` pins the build (`npm ci && npm run build`) and start (`npm run start`) commands; `.nvmrc` pins Node 20.
3. After the first deploy, Railway assigns a domain (e.g. `moladus-crm-production.up.railway.app`). Note it — it's your `NEXT_PUBLIC_APP_URL`.

## 2. Set environment variables (Railway → service → Variables)
Use `.env.production.example` as the checklist. Required:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret/service-role key |
| `ENCRYPTION_KEY` | 32-byte hex (provided separately) — **keep stable** |
| `CRON_SECRET` | 32-byte hex (provided separately) |
| `BUSINESS_STATE` | e.g. `MH` |
| `NEXT_PUBLIC_APP_URL` | the Railway domain, no trailing slash |
| `ALTCHA_HMAC_KEY` | 32-byte hex (provided separately) |
| `NEXT_PUBLIC_CAPTCHA_ENABLED` | `true` |

Razorpay/AiSensy keys are **optional as env** — you can instead enter them in-app at **Settings → Integrations** (encrypted at rest). Set them in whichever place you prefer.

Redeploy after setting variables so they take effect.

## 3. Create the admin login
The app has no self-service signup. Create your admin user once:
- Supabase → **Authentication → Users → Add user** (email + password, mark email confirmed), **or** after signing in the seeded bootstrap admin (`ghosaldhiraj@gmail.com`) via Supabase.
- Then in the app: **Settings → Users** to assign roles, and **Settings → Users → Invite a user** to add teammates (sends a set-password email — needs Supabase Auth SMTP configured for real delivery).

## 4. Enter provider credentials (if not set as env)
Sign in → **Settings → Integrations**:
- Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Use **Test** to verify.
- AiSensy: `AISENSY_API_KEY` (send side), `AISENSY_WEBHOOK_SECRET` (inbound chat, Pro plan).

## 5. Register provider webhooks (copy URLs from Settings → Integrations)
- **Razorpay dashboard → Webhooks:** add `https://<domain>/api/webhooks/razorpay`, event `payment_link.paid` (+ `payment_link.expired`/`cancelled` if desired). Set the signing secret to match `RAZORPAY_WEBHOOK_SECRET`.
- **AiSensy Custom App (Pro) → Webhooks:** subscribe `message.sender.user` (and/or `message.created`) to `https://<domain>/api/webhooks/aisensy`. Set its shared secret to match `AISENSY_WEBHOOK_SECRET`.

## 6. Wire the scheduled scan (drives SLA reminders + outbound webhook delivery)
The included **GitHub Actions workflow** (`.github/workflows/cron.yml`) calls `/api/cron/scan` every 5 minutes. Enable it:
- GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
  - `APP_URL` = `https://<your-railway-domain>` (no trailing slash)
  - `CRON_SECRET` = same value as in Railway
- The workflow runs on its schedule automatically; trigger a manual run (**Actions → Scheduled scan → Run workflow**) to smoke-test — expect HTTP 200 and `{"fired":…,"delivered":…,"failed":…}`.

*(Alternative: Railway's own cron, or any scheduler hitting the same URL with the bearer.)*

## 7. Smoke test the live loop
1. Open a published form `https://<domain>/f/<slug>`, solve the Altcha widget, submit → redirected to the Razorpay link (or the "we'll be in touch" confirmation for a call-requested route).
2. Pay the test link → Razorpay fires `payment_link.paid` → deal flips to paid, receipt WhatsApp sent, `deal.paid` outbound webhooks queued.
3. Within ~5 min the scheduled scan delivers any due reminders + outbound webhooks. Check **Settings → Webhooks** delivery log and the deal's activity timeline.

## Rollback
Railway keeps previous deploys — **Deployments → … → Redeploy** an earlier build. DB migrations are additive; no destructive rollback needed for a code revert.

## Notes
- All secrets live in Railway env and/or the encrypted `integration_settings` table — never in git.
- `ENCRYPTION_KEY` must stay stable once secrets are saved in-app, or they can't be decrypted.
- The scheduled scan is idempotent (at-most-once SLA firing; webhook retries with backoff), so occasional double-runs are safe.
