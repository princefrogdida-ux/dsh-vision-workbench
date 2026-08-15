import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { inspectRaster } from '../src/image.js'
import { LazyPlaywrightBrowserCapture } from '../src/browser.js'

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>Vision smoke</title><style>body{margin:0;height:820px;background:#123456;color:white}h1{margin:0}</style><h1>Stage 3</h1>')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
assert.ok(address !== null && typeof address === 'object')
const backend = new LazyPlaywrightBrowserCapture({
  enabled: true,
  browserChannel: 'msedge',
  allowedHosts: ['127.0.0.1'],
  allowPrivateHosts: true,
  viewportWidth: 800,
  viewportHeight: 600,
  maxPageHeight: 1200,
  navigationTimeoutMs: 15000,
}, 1_000_000)

try {
  const capture = await backend.capture({
    url: `http://127.0.0.1:${address.port}/`,
    fullPage: true,
    waitAfterLoadMs: 0,
  }, new AbortController().signal)
  const image = inspectRaster(capture.bytes)
  assert.equal(capture.status, 200)
  assert.equal(capture.title, 'Vision smoke')
  assert.equal(image.width, 800)
  assert.equal(image.height, 820)
  process.stdout.write(`${JSON.stringify({
    browser: 'msedge',
    status: capture.status,
    title: capture.title,
    width: image.width,
    height: image.height,
    bytes: capture.bytes.byteLength,
    blockedRequests: capture.blockedRequests,
  })}\n`)
} finally {
  await backend.dispose()
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
}
