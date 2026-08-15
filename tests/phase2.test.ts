import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { SessionAttachmentIndex } from '../src/attachments.js'
import { LruTtlCache } from '../src/cache.js'
import type { Config } from '../src/config.js'
import { runVisionCompare, runVisionCrop, runVisionPalette } from '../src/local-tools.js'
import { runVisionOcr } from '../src/ocr-tool.js'
import type { VisionOcrResult } from '../src/ocr-tool.js'
import { LazySharpRasterBackend, validateCropRegion } from '../src/raster.js'
import type { RasterBackend } from '../src/raster.js'
import type { LoadedImage } from '../src/types.js'
import { apply } from '../src/index.js'

const config: Config = {
  enabled: true,
  wrapperRoute: 'deepseek-vision-workbench',
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
  limits: { maxImagesPerCall: 4, maxImageBytes: 1024 * 1024, maxImagePixels: 100 },
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

async function png(width: number, height: number, rgba: number[]): Promise<Uint8Array> {
  return sharp(Uint8Array.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer()
}

function execution(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: { session: { id: 'session-2', header: {} } },
  } as unknown as ToolRunContext
}

test('Sharp backend crops, compares, and extracts a deterministic palette', async () => {
  const beforeBytes = await png(2, 2, [
    255, 0, 0, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255,
  ])
  const afterBytes = await png(2, 2, [
    0, 0, 255, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255,
  ])
  const backend = new LazySharpRasterBackend(100)
  const before = { id: 'before', mediaType: 'image/png' as const, bytes: beforeBytes, width: 2, height: 2 }
  const after = { id: 'after', mediaType: 'image/png' as const, bytes: afterBytes, width: 2, height: 2 }
  const crop = await backend.crop(before, { x: 0, y: 0, width: 1, height: 1 })
  assert.deepEqual({ width: crop.width, height: crop.height, mediaType: crop.mediaType }, {
    width: 1,
    height: 1,
    mediaType: 'image/png',
  })
  const comparison = await backend.compare(before, after, 0)
  assert.equal(comparison.totalPixels, 4)
  assert.equal(comparison.changedPixels, 1)
  assert.equal(comparison.changedRatio, 0.25)
  assert.equal(comparison.maxChannelDifference, 255)
  assert.deepEqual(await backend.palette(before, 2), [{
    hex: '#fc0404',
    red: 252,
    green: 4,
    blue: 4,
    pixels: 4,
    ratio: 1,
  }])
})

test('local tools persist derived PNG references and return comparison evidence', async () => {
  const beforeBytes = await png(2, 2, new Array(4).fill([255, 255, 255, 255]).flat())
  const afterBytes = await png(2, 2, [
    0, 0, 0, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255,
  ])
  const refs = [
    { attachmentId: 'sha256:before', mediaType: 'image/png' as const, bytes: beforeBytes.byteLength, width: 2, height: 2 },
    { attachmentId: 'sha256:after', mediaType: 'image/png' as const, bytes: afterBytes.byteLength, width: 2, height: 2 },
  ]
  const index = new SessionAttachmentIndex()
  index.remember('session-2', [{ content: refs.map(attachment => ({ type: 'image', attachment })) }])
  let saves = 0
  const byId = new Map([[refs[0].attachmentId, beforeBytes], [refs[1].attachmentId, afterBytes]])
  const ctx = {
    get(name: string) {
      if (name !== 'attachments') return undefined
      return {
        async readImage(ref: typeof refs[number]) { return { ref, data: byId.get(ref.attachmentId) } },
        async saveImage(input: { data: Uint8Array; mediaType: 'image/png'; name: string }) {
          saves += 1
          const metadata = await sharp(input.data).metadata()
          return {
            attachmentId: `sha256:derived-${saves}`,
            mediaType: input.mediaType,
            bytes: input.data.byteLength,
            width: metadata.width,
            height: metadata.height,
            name: input.name,
          }
        },
      }
    },
  } as unknown as Context
  const dependencies = { ctx, config, attachments: index, raster: new LazySharpRasterBackend(100) }
  const cropped = await runVisionCrop({
    attachment_id: refs[0].attachmentId,
    region: { x: 0, y: 0, width: 1, height: 2 },
  }, execution(), dependencies)
  assert.equal(cropped.attachment.width, 1)
  assert.equal(cropped.attachment.height, 2)
  const compared = await runVisionCompare({
    before: { attachment_id: refs[0].attachmentId },
    after: { attachment_id: refs[1].attachmentId },
    tolerance: 0,
  }, execution(), dependencies)
  assert.equal(compared.changedPixels, 1)
  assert.equal(compared.diffAttachment.name, 'vision-diff.png')
  const palette = await runVisionPalette({ attachment_id: refs[0].attachmentId, count: 3 }, execution(), dependencies)
  assert.equal(palette.colors[0]?.hex, '#fcfcfc')
  assert.equal(saves, 2)
})

test('provider OCR supports bounded caching without loading Sharp when no region is requested', async () => {
  const bytes = await png(1, 1, [255, 255, 255, 255])
  const ref = { attachmentId: 'sha256:ocr', mediaType: 'image/png' as const, bytes: bytes.byteLength, width: 1, height: 1 }
  const index = new SessionAttachmentIndex()
  index.remember('session-2', [{ content: [{ type: 'image', attachment: ref }] }])
  const ctx = {
    get(name: string) {
      return name === 'attachments' ? { async readImage() { return { ref, data: bytes } } } : undefined
    },
  } as unknown as Context
  let calls = 0
  let cropCalls = 0
  const raster = {
    async crop() {
      cropCalls += 1
      return { bytes, mediaType: 'image/png' as const, width: 1, height: 1 }
    },
    async compare() { throw new Error('unused') },
    async palette() { throw new Error('unused') },
  } as unknown as RasterBackend
  const dependencies = {
    ctx,
    config,
    attachments: index,
    cache: new LruTtlCache<VisionOcrResult>(10, 60_000),
    raster,
    localOcr: {
      enabled: false,
      languages: ['eng'],
      cacheIdentity: 'local-disabled',
      async recognize() { throw new Error('unused') },
      async dispose() {},
    },
    client: {
      cacheIdentity: 'primary:vision-model',
      async analyze(images: readonly LoadedImage[]) {
        calls += 1
        assert.equal(images[0]?.width, 1)
        return {
          answer: 'settings dialog', text: 'Save\nCancel', regions: [], warnings: [],
          provider: 'primary', model: 'vision-model', providerAttempts: 1, fallbackUsed: false,
        }
      },
    },
  }
  const first = await runVisionOcr({ attachment_id: ref.attachmentId, language_hint: 'English' }, execution(), dependencies)
  const second = await runVisionOcr({ attachment_id: ref.attachmentId, language_hint: 'English' }, execution(), dependencies)
  assert.equal(first.text, 'Save\nCancel')
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(calls, 1)
  assert.equal(cropCalls, 0)
  const region = await runVisionOcr({
    attachment_id: ref.attachmentId,
    language_hint: 'Chinese',
    region: { x: 0, y: 0, width: 1, height: 1 },
  }, execution(), dependencies)
  assert.equal(region.cropped, true)
  assert.equal(cropCalls, 1)
  assert.equal(calls, 2)
})

test('local backend and crop bounds fail with actionable errors', async () => {
  assert.throws(
    () => validateCropRegion({ x: 1, y: 1, width: 2, height: 2 }, { width: 2, height: 2 }),
    /exceeds the 2x2 image bounds/,
  )
  const unavailable = new LazySharpRasterBackend(100, async () => {
    throw new Error('simulated missing binary')
  })
  await assert.rejects(
    unavailable.crop({
      id: 'x',
      mediaType: 'image/png',
      bytes: Uint8Array.from([1]),
      width: 1,
      height: 1,
    }, { x: 0, y: 0, width: 1, height: 1 }),
    /simulated missing binary/,
  )
})

test('plugin registration exposes five tools and its owned cleanup disposes without a provider call', async () => {
  const names: string[] = []
  let cleanup: (() => Promise<void>) | undefined
  const ctx = {
    logger: { info() {} },
    llm: { registerAdapter() { return () => {} } },
    tools: {
      register(definition: { name: string }) {
        names.push(definition.name)
        return () => {}
      },
    },
    get() { return undefined },
    effect(factory: () => () => Promise<void>) {
      cleanup = factory()
      return () => {}
    },
  } as unknown as Context
  apply(ctx, config)
  assert.deepEqual(names, [
    'vision_describe',
    'vision_crop',
    'vision_compare',
    'vision_palette',
    'vision_ocr',
  ])
  assert.ok(cleanup)
  await cleanup()
})
