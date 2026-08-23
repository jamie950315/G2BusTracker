const DYNAMIC_TTL_MAX_MS = 2_000
const DYNAMIC_MAX_STALE_MS = 30_000
const STATIC_MAX_STALE_MS = 24 * 60 * 60_000

export function canServeStale(ttlMs, ageMs) {
  const maxStaleMs = ttlMs <= DYNAMIC_TTL_MAX_MS
    ? DYNAMIC_MAX_STALE_MS
    : STATIC_MAX_STALE_MS
  return ageMs <= maxStaleMs
}

export function staleCacheControl(stale, dynamic) {
  if (dynamic) return 'no-store'
  return stale ? 'no-cache, max-age=0' : 'public, max-age=300'
}
