import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getEnv } from '@/lib/env'

/**
 * App-level AES-256-GCM encryption for the integration-settings secret store
 * (Spec A). The master key is `ENCRYPTION_KEY` (32-byte hex) from env, never
 * leaves the server. Ciphertext format is `base64(iv):base64(tag):base64(data)`.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

/** Resolve the 32-byte AES key from the hex env var. */
function getKey(): Buffer {
  const key = Buffer.from(getEnv().ENCRYPTION_KEY, 'hex')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  }
  return key
}

/** Encrypt a plaintext secret. Returns `base64(iv):base64(tag):base64(data)`. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${enc.toString('base64')}`
}

/** Decrypt a ciphertext produced by `encryptSecret`. Throws on tamper/auth failure. */
export function decryptSecret(enc: string): string {
  const [ivB64, tagB64, dataB64] = enc.split(':')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed ciphertext')
  }
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(authTag)
  const dec = Buffer.concat([decipher.update(data), decipher.final()])
  return dec.toString('utf8')
}
