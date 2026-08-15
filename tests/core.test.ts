import assert from 'node:assert/strict'
import test from 'node:test'
import { collectImageRefs, rewriteImagesForTextModel, SessionAttachmentIndex } from '../src/attachments.js'
import { LruTtlCache } from '../src/cache.js'
import { inspectRaster } from '../src/image.js'
import { validateRuntimeConfig } from '../src/config.js'
import type { Config } from '../src/config.js'

const ref = {
  attachmentId: 'sha256:test',
  mediaType: 'image/png' as const,
  bytes: 24,
  width: 2,
  height: 3,
  name: 'screen.png',
}

test('collects durable image refs and rewrites without mutating the log input', () => {
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: 'what is this?' },
      { type: 'image', attachment: ref },
      { type: 'tool-result', content: [{ type: 'image', attachment: ref }] },
    ],
  }]
  assert.deepEqual(collectImageRefs(messages), [ref])
  const rewritten = rewriteImagesForTextModel(messages)
  assert.notEqual(rewritten, messages)
  assert.equal(messages[0]?.content[1]?.type, 'image')
  const text = JSON.stringify(rewritten)
  assert.match(text, /vision_describe/)
  assert.match(text, /sha256:test/)
  assert.doesNotMatch(text, /"type":"image"/)
})

test('attachment index is session-scoped and LRU-bounded', () => {
  const index = new SessionAttachmentIndex(1, 2)
  index.remember('a', [{ content: [{ type: 'image', attachment: ref }] }])
  assert.equal(index.get('a', ref.attachmentId)?.width, 2)
  index.remember('b', [{ content: [{ type: 'image', attachment: { ...ref, attachmentId: 'sha256:b' } }] }])
  assert.equal(index.get('a', ref.attachmentId), undefined)
  assert.equal(index.get('b', 'sha256:b')?.height, 3)
})

test('LRU cache applies TTL and capacity', () => {
  let now = 100
  const cache = new LruTtlCache<string>(2, 50, () => now)
  cache.set('a', 'A')
  cache.set('b', 'B')
  assert.equal(cache.get('a'), 'A')
  cache.set('c', 'C')
  assert.equal(cache.get('b'), undefined)
  now = 151
  assert.equal(cache.get('a'), undefined)
})

test('bounded header inspection recognizes PNG, JPEG, and WebP dimensions', () => {
  const png = new Uint8Array(24)
  png.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  png.set([73, 72, 68, 82], 12)
  png.set([0, 0, 0, 2, 0, 0, 0, 3], 16)
  assert.deepEqual(inspectRaster(png), { mediaType: 'image/png', width: 2, height: 3 })

  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x00, 0x03, 0x00, 0x02,
    0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
  ])
  assert.deepEqual(inspectRaster(jpeg), { mediaType: 'image/jpeg', width: 2, height: 3 })

  const webp = new Uint8Array(30)
  webp.set(new TextEncoder().encode('RIFF'), 0)
  webp.set(new TextEncoder().encode('WEBP'), 8)
  webp.set(new TextEncoder().encode('VP8X'), 12)
  webp.set([1, 0, 0, 2, 0, 0], 24)
  assert.deepEqual(inspectRaster(webp), { mediaType: 'image/webp', width: 2, height: 3 })
})

test('unsupported image bytes fail closed', () => {
  assert.throws(() => inspectRaster(Uint8Array.from([1, 2, 3])), /unsupported image format/)
})

test('enabled configuration rejects route takeover and insecure remote endpoints', () => {
  const config: Config = {
    enabled: true,
    wrapperRoute: 'deepseek-official',
    textProvider: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    visionProvider: {
      name: 'primary',
      baseURL: 'https://vision.example/v1',
      model: 'vision-model',
      credentialRef: 'VISION_KEY',
      allowKeyless: false,
      allowInsecureLocalhost: false,
      maxTokens: 1024,
    },
    fallbackProviders: [],
    providerRouting: { attemptTimeoutMs: 1000, failureThreshold: 2, cooldownSeconds: 60 },
    limits: { maxImagesPerCall: 4, maxImageBytes: 1024, maxImagePixels: 100 },
    cache: { enabled: true, maxEntries: 10, ttlSeconds: 60 },
    localProcessing: { enabled: true, maxWorkingPixels: 100 },
    localOcr: {
      enabled: false,
      languagePath: '',
      languages: ['eng'],
      gzip: true,
      timeoutMs: 60000,
      maxLanguageBytes: 50 * 1024 * 1024,
      maxRegions: 50,
      pageSegMode: 'auto',
      autoRotate: true,
      lowConfidenceThreshold: 40,
    },
    browserCapture: {
      enabled: false,
      browserChannel: 'msedge',
      allowedHosts: [],
      allowPrivateHosts: false,
      viewportWidth: 1440,
      viewportHeight: 900,
      maxPageHeight: 12000,
      navigationTimeoutMs: 30000,
    },
    timeoutMs: 1000,
    proxyUrl: '',
  }
  assert.throws(() => validateRuntimeConfig(config), /must not replace deepseek-official/)
  assert.throws(
    () => validateRuntimeConfig({
      ...config,
      wrapperRoute: 'deepseek-vision-workbench',
      visionProvider: { ...config.visionProvider, baseURL: 'http://vision.example/v1' },
    }),
    /must use HTTPS/,
  )
})
