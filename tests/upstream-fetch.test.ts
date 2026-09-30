import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { fetchUpstream } from '../server/upstream-fetch.mjs'

async function startUpstream(
  t: test.TestContext,
  handler: http.RequestListener,
) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}/feed.gz`
}

test('rejects an interrupted body and permits a subsequent request', async (t) => {
  let requestCount = 0
  const url = await startUpstream(t, (_request, response) => {
    requestCount += 1
    response.writeHead(200, { etag: 'feed-version', 'last-modified': 'Tue, 29 Sep 2026 00:00:00 GMT' })
    if (requestCount === 1) {
      response.write('partial')
      setTimeout(() => response.destroy(), 10)
      return
    }
    response.end('complete feed')
  })

  await assert.rejects(fetchUpstream(url, { get: http.get }), /aborted/)
  const entry = await fetchUpstream(url, { get: http.get })
  assert.equal(entry.body.toString(), 'complete feed')
  assert.equal(entry.etag, 'feed-version')
  assert.equal(entry.lastModified, 'Tue, 29 Sep 2026 00:00:00 GMT')
})

test('rejects a stalled body at timeout and closes its connection', async (t) => {
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
  const url = await startUpstream(t, (_request, response) => {
    response.writeHead(200)
    response.write('partial')
    response.once('close', resolveClosed)
  })

  await assert.rejects(fetchUpstream(url, { get: http.get, timeoutMs: 50 }), /upstream timeout/)
  await closed
})
