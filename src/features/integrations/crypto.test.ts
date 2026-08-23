import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/env', () => ({ getEnv: () => ({ ENCRYPTION_KEY: 'a'.repeat(64) }) })) // 32 bytes hex
import { encryptSecret, decryptSecret } from './crypto'
describe('secret crypto', () => {
  it('round-trips', () => { const c = encryptSecret('sk_live_123'); expect(c).not.toContain('sk_live_123'); expect(decryptSecret(c)).toBe('sk_live_123') })
  it('unique ciphertext per call (random IV)', () => { expect(encryptSecret('x')).not.toBe(encryptSecret('x')) })
  it('tampered ciphertext throws', () => { const c = encryptSecret('y'); const bad = c.slice(0, -2) + (c.endsWith('a') ? 'b' : 'a'); expect(() => decryptSecret(bad)).toThrow() })
})
