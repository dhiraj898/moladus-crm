import crypto from 'node:crypto'

/**
 * Razorpay webhook signature verification (spec §8, §11).
 *
 * Razorpay signs the webhook by computing HMAC-SHA256 over the RAW request body
 * using the webhook secret, and sends the hex digest in `X-Razorpay-Signature`.
 * We recompute the same digest and compare in constant time. The caller MUST
 * pass the raw, unparsed body — re-serialising parsed JSON changes the bytes and
 * would always fail verification.
 */
export function verifyRazorpaySignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const expectedBuf = Buffer.from(expected, 'utf8')
  const providedBuf = Buffer.from(signature, 'utf8')

  // timingSafeEqual throws if lengths differ; guard first so a length mismatch
  // returns false instead of throwing.
  if (expectedBuf.length !== providedBuf.length) return false

  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}
