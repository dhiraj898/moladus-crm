import 'server-only'

/**
 * In-memory sliding-window rate limiter for the ingest endpoint (spec §6 step 1).
 *
 * v1 keeps a module-level `Map<ip, timestamps[]>`. On each check we prune
 * timestamps older than the window, then allow the request iff fewer than
 * `MAX_REQUESTS` remain in the trailing window. This is per-process (a single
 * Railway instance); a distributed limiter (Upstash Redis) is the documented v2
 * upgrade in the spec and swaps in behind this same signature.
 */

/** Requests allowed per IP per window. */
const MAX_REQUESTS = 5
/** Sliding window length in milliseconds. */
const WINDOW_MS = 60_000

/** ip → recent request timestamps (ms epoch), oldest first. */
const hits = new Map<string, number[]>()

/**
 * Record a request from `ip` and report whether it is allowed. Returns `true`
 * when the request is within the limit (and counts it), `false` when the IP has
 * already made `MAX_REQUESTS` in the trailing window.
 */
export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const cutoff = now - WINDOW_MS

  const recent = (hits.get(ip) ?? []).filter((ts) => ts > cutoff)

  if (recent.length >= MAX_REQUESTS) {
    // Keep the pruned list so the window keeps sliding correctly.
    hits.set(ip, recent)
    return false
  }

  recent.push(now)
  hits.set(ip, recent)
  return true
}

/** Test-only: clear all recorded hits so cases don't leak into one another. */
export function __resetRateLimit(): void {
  hits.clear()
}
