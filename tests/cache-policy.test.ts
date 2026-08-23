import assert from 'node:assert/strict'
import test from 'node:test'

import { canServeStale, staleCacheControl } from '../server/cache-policy.mjs'

test('rejects dynamic cached data after its maximum stale age', () => {
  assert.equal(canServeStale(2_000, 29_999), true)
  assert.equal(canServeStale(2_000, 30_001), false)
})

test('requires stale static data to revalidate before shared caches reuse it', () => {
  assert.equal(staleCacheControl(true, false), 'no-cache, max-age=0')
  assert.equal(staleCacheControl(false, false), 'public, max-age=300')
  assert.equal(staleCacheControl(false, true), 'no-store')
})
