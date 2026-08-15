import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { SessionAttachmentIndex } from '../src/attachments.js'
import { LruTtlCache } from '../src/cache.js'
import type { Config } from '../src/config.js'
import { validateRuntimeConfig } from '../src/config.js'
import { LazyTesseractOcrBackend } from '../src/local-ocr.js'
import type { TesseractLoader } from '../src/local-ocr.js'
import { runVisionOcr } from '../src/ocr-tool.js'
import type { VisionOcrResult } from '../src/ocr-tool.js'
import type { RasterBackend } from '../src/raster.js'
import type { LoadedImage } from '../src/types.js'

function configuration(languagePath: string): Config {
  return {
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
    limits: { maxImagesPerCall: 4, maxImageBytes: 1024 * 1024, maxImagePixels: 1_000_000 },
    cache: { enabled: true, maxEntries: 10, ttlSeconds: 60 },
    localProcessing: { enabled: true, maxWorkingPixels: 1_000_000 },
    localOcr: {
      enabled: true,
      languagePath,
      languages: ['eng'],
      gzip: true,
      timeoutMs: 5000,
      maxLanguageBytes: 1024 * 1024,
      maxRegions: 2,
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
    timeoutMs: 5000,
    proxyUrl: '',
  }
}

function execution(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: { session: { id: 'phase-5', header: {} } },
  } as unknown as ToolRunContext
}

test('enabled local OCR requires an absolute path and safe unique languages', () => {
  assert.throws(
    () => validateRuntimeConfig(configuration('relative/languages')),
    /absolute local filesystem path/,
  )
  const absolute = configuration(join(tmpdir(), 'languages'))
  assert.throws(
    () => validateRuntimeConfig({
      ...absolute,
      localOcr: { ...absolute.localOcr, languages: ['eng', '../chi_sim'] },
    }),
    /invalid localOcr.languages entry/,
  )
  assert.throws(
    () => validateRuntimeConfig({
      ...absolute,
      localOcr: { ...absolute.localOcr, languages: ['eng', 'eng'] },
    }),
    /duplicate localOcr.languages entry/,
  )
})

test('local OCR is explicit, cacheable, and never calls the provider router', async () => {
  const bytes = await sharp({
    create: { width: 200, height: 100, channels: 4, background: '#ffffff' },
  }).png().toBuffer()
  const ref = {
    attachmentId: 'sha256:phase5',
    mediaType: 'image/png' as const,
    bytes: bytes.byteLength,
    width: 200,
    height: 100,
  }
  const attachments = new SessionAttachmentIndex()
  attachments.remember('phase-5', [{ content: [{ type: 'image', attachment: ref }] }])
  const ctx = {
    get(name: string) {
      return name === 'attachments' ? { async readImage() { return { ref, data: bytes } } } : undefined
    },
  } as unknown as Context
  let localCalls = 0
  const config = configuration(join(tmpdir(), 'languages'))
  const dependencies = {
    ctx,
    config,
    attachments,
    cache: new LruTtlCache<VisionOcrResult>(10, 60_000),
    raster: {} as RasterBackend,
    localOcr: {
      enabled: true,
      languages: ['eng'],
      cacheIdentity: 'local-test',
      async recognize() {
        localCalls += 1
        return {
          text: 'HELLO 123',
          confidence: 91.5,
          regions: [{ name: 'text-block-1', description: 'HELLO 123' }],
          warnings: [],
        }
      },
      async dispose() {},
    },
    client: {
      cacheIdentity: 'provider-test',
      async analyze() { throw new Error('provider must not be called for local OCR') },
    },
  }
  const first = await runVisionOcr({ attachment_id: ref.attachmentId, backend: 'local' }, execution(), dependencies)
  const second = await runVisionOcr({ attachment_id: ref.attachmentId, backend: 'local' }, execution(), dependencies)
  assert.equal(first.backend, 'local')
  assert.equal(first.provider, 'local-tesseract')
  assert.equal(first.providerAttempts, 0)
  assert.equal(first.fallbackUsed, false)
  assert.equal(first.confidence, 91.5)
  assert.equal(second.cached, true)
  assert.equal(localCalls, 1)
})

test('Tesseract backend preflights data, serializes jobs, reuses one worker, and terminates it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-vision-ocr-'))
  await writeFile(join(directory, 'eng.traineddata.gz'), Uint8Array.from([1, 2, 3]))
  let workers = 0
  let terminations = 0
  let active = 0
  let maximumActive = 0
  const parameters: Record<string, string>[] = []
  const loader: TesseractLoader = async () => ({
    OEM: { LSTM_ONLY: '1' },
    PSM: { AUTO: '3', SINGLE_BLOCK: '6', SPARSE_TEXT: '11' },
    async createWorker(languages, oem, options) {
      workers += 1
      assert.deepEqual(languages, ['eng'])
      assert.equal(oem, '1')
      assert.equal(options.langPath, directory)
      assert.equal(options.cacheMethod, 'none')
      return {
        async setParameters(value) { parameters.push(value) },
        async recognize() {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await new Promise<void>(resolve => setImmediate(resolve))
          active -= 1
          return {
            data: {
              text: 'HELLO\n',
              confidence: 88,
              blocks: [{
                text: 'HELLO',
                confidence: 90,
                bbox: { x0: -5, y0: 2, x1: 120, y1: 40 },
              }],
            },
          }
        },
        async terminate() { terminations += 1 },
      }
    },
  })
  const config = configuration(directory)
  const backend = new LazyTesseractOcrBackend(config.localOcr, loader)
  const image: LoadedImage = {
    id: 'fixture',
    mediaType: 'image/png',
    bytes: Uint8Array.from([1, 2, 3]),
    width: 100,
    height: 50,
  }
  try {
    const [first, second] = await Promise.all([
      backend.recognize(image, new AbortController().signal),
      backend.recognize(image, new AbortController().signal),
    ])
    assert.equal(first.text, 'HELLO')
    assert.deepEqual(first.regions[0]?.box, { x: 0, y: 2, width: 100, height: 38 })
    assert.equal(second.confidence, 88)
    assert.equal(workers, 1)
    assert.equal(maximumActive, 1)
    assert.deepEqual(parameters, [{ tessedit_pageseg_mode: '3' }])
    await backend.dispose()
    assert.equal(terminations, 1)
  } finally {
    await backend.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Tesseract backend fails before loading code when a language file is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-vision-ocr-missing-'))
  let loaded = false
  const backend = new LazyTesseractOcrBackend(
    configuration(directory).localOcr,
    async () => {
      loaded = true
      throw new Error('must not load')
    },
  )
  try {
    await assert.rejects(
      backend.recognize({
        id: 'fixture',
        mediaType: 'image/png',
        bytes: Uint8Array.from([1]),
        width: 1,
        height: 1,
      }, new AbortController().signal),
      /language file is missing/,
    )
    assert.equal(loaded, false)
  } finally {
    await backend.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
