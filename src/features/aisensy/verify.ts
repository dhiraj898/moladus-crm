import crypto from 'node:crypto'

/**
 * Verify an AiSensy Project-API webhook signature (Spec 6 design §5).
 *
 * AiSensy signs the webhook by computing HMAC-SHA256 over the RAW request body
 * using the Custom App shared secret, and sends the hex digest in
 * `X-AiSensy-Signature`. We recompute and compare in constant time. The caller
 * MUST pass the raw, unparsed body — re-serialising parsed JSON changes the
 * bytes and would always fail. Tolerates an optional `sha256=` prefix.
 */
export function verifyAiSensySignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false

  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const expectedBuf = Buffer.from(expected, 'utf8')
  const providedBuf = Buffer.from(provided, 'utf8')

  // timingSafeEqual throws on length mismatch; guard first so a wrong length
  // returns false instead of throwing.
  if (expectedBuf.length !== providedBuf.length) return false

  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}
