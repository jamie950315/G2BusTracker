import http from 'node:http'
import { canServeStale, staleCacheControl } from './cache-policy.mjs'
import { fetchUpstream } from './upstream-fetch.mjs'

const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 8893)
const UPSTREAM_ORIGIN = 'https://tcgbusfs.blob.core.windows.net'

const feeds = new Map([
  ['/blobbus/GetStop.gz', { ttlMs: 5 * 60_000 }],
  ['/blobbus/GetRoute.gz', { ttlMs: 5 * 60_000 }],
  ['/blobbus/GetEstimateTime.gz', { ttlMs: 2_000 }],
  ['/blobbus/GetBusData.gz', { ttlMs: 2_000 }],
])

const cache = new Map()
const inFlight = new Map()

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-expose-headers': 'age, x-taiwan-bus-cache, x-taiwan-bus-fetched-at',
    'access-control-max-age': '86400',
  }
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload))
  response.writeHead(statusCode, {
    ...corsHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  response.end(body)
}

function refreshFeed(pathname) {
  let pending = inFlight.get(pathname)
  if (pending) return pending

  pending = fetchUpstream(`${UPSTREAM_ORIGIN}${pathname}`, {
    userAgent: 'taiwan-bus-g2-proxy/0.10.11',
  })
    .then((entry) => {
      cache.set(pathname, entry)
      return entry
    })
    .finally(() => inFlight.delete(pathname))
  inFlight.set(pathname, pending)
  return pending
}

async function getFeed(pathname) {
  const feed = feeds.get(pathname)
  const cached = cache.get(pathname)
  const now = Date.now()
  const cacheAgeMs = cached ? now - cached.fetchedAt : 0
  if (cached && cacheAgeMs < feed.ttlMs) {
    return { entry: cached, cacheStatus: 'HIT', stale: false }
  }

  if (cached && canServeStale(feed.ttlMs, cacheAgeMs)) {
    const wasRevalidating = inFlight.has(pathname)
    void refreshFeed(pathname).catch((error) => {
      console.error(new Date().toISOString(), pathname, 'background refresh failed', error)
    })
    return {
      entry: cached,
      cacheStatus: wasRevalidating ? 'REVALIDATING' : 'STALE',
      stale: true,
    }
  }

  return {
    entry: await refreshFeed(pathname),
    cacheStatus: cached ? 'EXPIRED' : 'MISS',
    stale: false,
  }
}

function feedHeaders(pathname, result) {
  const feed = feeds.get(pathname)
  const dynamic = feed.ttlMs <= 2_000
  return {
    ...corsHeaders(),
    'content-type': 'application/octet-stream',
    'content-length': result.entry.body.length,
    'cache-control': staleCacheControl(result.stale, dynamic),
    age: Math.max(0, Math.floor((Date.now() - result.entry.fetchedAt) / 1_000)),
    'x-taiwan-bus-cache': result.cacheStatus,
    'x-taiwan-bus-upstream': UPSTREAM_ORIGIN,
    'x-taiwan-bus-fetched-at': new Date(result.entry.fetchedAt).toISOString(),
    ...(result.entry.etag ? { etag: result.entry.etag } : {}),
    ...(result.entry.lastModified ? { 'last-modified': result.entry.lastModified } : {}),
    ...(result.stale ? { warning: '110 - Response is stale' } : {}),
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders())
      response.end()
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD, OPTIONS' })
      return
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'taiwan-bus-g2-proxy',
        version: '0.10.11',
        upstream: UPSTREAM_ORIGIN,
        checkedAt: new Date().toISOString(),
      })
      return
    }
    if (!feeds.has(url.pathname)) {
      sendJson(response, 404, { error: 'not_found' })
      return
    }

    const result = await getFeed(url.pathname)
    response.writeHead(200, feedHeaders(url.pathname, result))
    response.end(request.method === 'HEAD' ? undefined : result.entry.body)
  } catch (error) {
    console.error(new Date().toISOString(), request.url, error)
    sendJson(response, 502, {
      error: 'upstream_unavailable',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`taiwan-bus-g2-proxy listening on http://${HOST}:${PORT}`)
  void Promise.allSettled(
    [...feeds.keys()].map((pathname) => refreshFeed(pathname)),
  ).then((results) => {
    const ready = results.filter((result) => result.status === 'fulfilled').length
    console.log(`prewarmed ${ready}/${feeds.size} feeds`)
  })
})

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
