import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the getSecret resolver (Task 2.1): DB decrypted override first,
 * then env fallback, then undefined. DB/decrypt failures fall back to env.
 *
 * `@/lib/env`, `@/lib/supabase/server`, and `./crypto` are mocked through
 * mutable hoisted holders so each test can shape the DB row, env value, and
 * decrypt behavior independently.
 */

const { state } = vi.hoisted(() => ({
  state: {
    // integration_settings row for the requested key (null = absent).
    row: null as { value_enc: string } | null,
    // Error object returned alongside the row (null = success).
    dbError: null as { message: string } | null,
    // Whether decryptSecret should throw (simulates tamper/auth failure).
    decryptThrows: false,
    // Env fallback values keyed by SecretKey.
    env: {} as Record<string, string | undefined>,
  },
}))

const maybeSingleMock = vi.fn(async () => ({ data: state.row, error: state.dbError }))

vi.mock('@/lib/env', () => ({
  getEnv: () => state.env,
}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: maybeSingleMock }),
      }),
    }),
  }),
}))

vi.mock('./crypto', () => ({
  decryptSecret: (enc: string) => {
    if (state.decryptThrows) throw new Error('auth failure')
    return `decrypted:${enc}`
  },
}))

import { getSecret } from './secrets'

beforeEach(() => {
  vi.clearAllMocks()
  state.row = null
  state.dbError = null
  state.decryptThrows = false
  state.env = {}
})

describe('getSecret', () => {
  it('returns the decrypted DB override when a row is present', async () => {
    state.row = { value_enc: 'cipher123' }
    state.env.RAZORPAY_KEY_ID = 'env_value'
    await expect(getSecret('RAZORPAY_KEY_ID')).resolves.toBe('decrypted:cipher123')
  })

  it('falls back to the env value when no DB row exists', async () => {
    state.row = null
    state.env.AISENSY_API_KEY = 'env_api_key'
    await expect(getSecret('AISENSY_API_KEY')).resolves.toBe('env_api_key')
  })

  it('returns undefined when neither DB nor env has the secret', async () => {
    state.row = null
    await expect(getSecret('RAZORPAY_WEBHOOK_SECRET')).resolves.toBeUndefined()
  })

  it('falls back to env when the DB lookup errors', async () => {
    state.dbError = { message: 'db down' }
    state.env.AISENSY_WEBHOOK_SECRET = 'env_webhook'
    await expect(getSecret('AISENSY_WEBHOOK_SECRET')).resolves.toBe('env_webhook')
  })

  it('falls back to env when decryption throws (tamper/auth failure)', async () => {
    state.row = { value_enc: 'tampered' }
    state.decryptThrows = true
    state.env.RAZORPAY_KEY_SECRET = 'env_secret'
    await expect(getSecret('RAZORPAY_KEY_SECRET')).resolves.toBe('env_secret')
  })
})
