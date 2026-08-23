import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  AISENSY_API_KEY: z.string().min(1),
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
