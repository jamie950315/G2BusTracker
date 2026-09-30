import https from 'node:https'

export function fetchUpstream(url, {
  get = https.get,
  timeoutMs = 15_000,
  userAgent,
} = {}) {
  return new Promise((resolve, reject) => {
    const request = get(url, {
      headers: {
        accept: 'application/octet-stream',
        'accept-encoding': 'identity',
        ...(userAgent ? { 'user-agent': userAgent } : {}),
      },
      timeout: timeoutMs,
    }, (upstream) => {
      const chunks = []
      upstream.on('data', (chunk) => chunks.push(chunk))
      upstream.once('error', reject)
      upstream.once('end', () => {
        if (upstream.statusCode !== 200) {
          reject(new Error(`upstream HTTP ${upstream.statusCode ?? 0}`))
          return
        }
        const body = Buffer.concat(chunks)
        if (body.length === 0) {
          reject(new Error('upstream returned an empty body'))
          return
        }
        resolve({
          body,
          fetchedAt: Date.now(),
          etag: upstream.headers.etag,
          lastModified: upstream.headers['last-modified'],
        })
      })
    })
    request.once('timeout', () => request.destroy(new Error('upstream timeout')))
    request.once('error', reject)
  })
}
