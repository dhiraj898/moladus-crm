import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Master key for the encrypted integration-settings store (32-byte hex → 64
  // hex chars). Server-only, required. Generate via `openssl rand -hex 32`.
  ENCRYPTION_KEY: z.string().min(32),
  // Provider secrets may now live only in the encrypted DB store (Spec A), so
  // they are optional in env — getSecret() resolves DB-override then env.
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  AISENSY_API_KEY: z.string().min(1).optional(),
  AISENSY_WEBHOOK_SECRET: z.string().min(1).optional(),
  ALTCHA_HMAC_KEY: z.string().min(1),
  NEXT_PUBLIC_CAPTCHA_ENABLED: z.string().optional(),
  BUSINESS_STATE: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  CRON_SECRET: z.string().min(1),
})

export type Env = z.infer<typeof schema>

// Parse lazily so the build doesn't fail without env; throws at first real use.
let cached: Env | null = null

export function getEnv(): Env {
  if (cached) return cached
  cached = schema.parse(process.env)
  return cached
}
