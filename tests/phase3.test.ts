import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { BrowserRequestPolicy, isPrivateAddress, parseBrowserUrl } from '../src/browser-policy.js'
import type { BrowserCaptureBackend } from '../src/browser.js'
import { runVisionBrowserCapture } from '../src/browser-tool.js'
import type { Config } from '../src/config.js'
import { validateRuntimeConfig } from '../src/config.js'
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
  limits: { maxImagesPerCall: 4, maxImageBytes: 1024 * 1024, maxImagePixels: 2_000_000 },
  cache: { enabled: true, maxEntries: 10, ttlSeconds: 60 },
  localProcessing: { enabled: true, maxWorkingPixels: 2_000_000 },
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
    enabled: true,
    browserChannel: 'msedge',
    allowedHosts: ['example.com'],
    allowPrivateHosts: false,
    viewportWidth: 800,
    viewportHeight: 600,
    maxPageHeight: 12000,
    navigationTimeoutMs: 30000,
  },
  timeoutMs: 1000,
  proxyUrl: '',
}

function execution(): ToolRunContext {
  return { signal: new AbortController().signal, agent: { session: { id: 'session-3', header: {} } } } as unknown as ToolRunContext
}

test('browser URL policy requires exact allowlist membership and rejects unsafe schemes and credentials', async () => {
  const policy = new BrowserRequestPolicy(config.browserCapture, async () => ['93.184.216.34'])
  assert.equal((await policy.assertAllowed('https://example.com/a')).hostname, 'example.com')
  await assert.rejects(policy.assertAllowed('https://sub.example.com/'), /blocked host/)
  assert.throws(() => parseBrowserUrl('file:///C:/secret.txt'), /only http:\/\/ and https:\/\//)
  assert.throws(() => parseBrowserUrl('https://user:pass@example.com/'), /credentials embedded/)
})

test('browser URL policy rejects private literals and private DNS answers unless explicitly enabled', async () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true)
  assert.equal(isPrivateAddress('169.254.169.254'), true)
  assert.equal(isPrivateAddress('10.1.2.3'), true)
  assert.equal(isPrivateAddress('93.184.216.34'), false)
  const privateDns = new BrowserRequestPolicy({ allowedHosts: ['internal.example'], allowPrivateHosts: false }, async () => ['192.168.1.3'])
  await assert.rejects(privateDns.assertAllowed('https://internal.example/'), /resolved to private address/)
  const local = new BrowserRequestPolicy({ allowedHosts: ['127.0.0.1'], allowPrivateHosts: true }, async () => ['127.0.0.1'])
  assert.equal((await local.assertAllowed('http://127.0.0.1:4173/')).port, '4173')
})

test('browser configuration stays deny-by-default and validates exact hosts', () => {
  assert.throws(
    () => validateRuntimeConfig({ ...config, browserCapture: { ...config.browserCapture, allowedHosts: [] } }),
    /must contain at least one/,
  )
  assert.throws(
    () => validateRuntimeConfig({ ...config, browserCapture: { ...config.browserCapture, allowedHosts: ['*.example.com'] } }),
    /exact hostnames/,
  )
  assert.throws(
    () => validateRuntimeConfig({ ...config, browserCapture: { ...config.browserCapture, allowedHosts: ['bad host'] } }),
    /invalid browserCapture/,
  )
  validateRuntimeConfig(config)
})

test('provider configuration rejects duplicate names and insecure fallback endpoints', () => {
  assert.throws(
    () => validateRuntimeConfig({
      ...config,
      fallbackProviders: [{ ...config.visionProvider, baseURL: 'https://backup.example/v1' }],
    }),
    /duplicate vision provider name/,
  )
  assert.throws(
    () => validateRuntimeConfig({
      ...config,
      fallbackProviders: [{
        ...config.visionProvider,
        name: 'backup',
        baseURL: 'http://backup.example/v1',
      }],
    }),
    /fallbackProviders\[0\]\.baseURL must use HTTPS/,
  )
  assert.throws(
    () => validateRuntimeConfig({
      ...config,
      fallbackProviders: ['a', 'b', 'c', 'd'].map(name => ({
        ...config.visionProvider,
        name,
        baseURL: `https://${name}.example/v1`,
      })),
    }),
    /at most three/,
  )
})

test('browser capture stores a bounded durable PNG without leaking raw bytes into the result', async () => {
  const bytes = await sharp({
    create: { width: 800, height: 600, channels: 4, background: '#ffffff' },
  }).png().toBuffer()
  let capturedInput: unknown
  let disposed = false
  const browser: BrowserCaptureBackend = {
    async capture(input) {
      capturedInput = input
      return {
        requestedUrl: 'https://example.com/',
        finalUrl: 'https://example.com/home',
        title: 'Example',
        status: 200,
        fullPage: false,
        viewportWidth: 800,
        viewportHeight: 600,
        pageWidth: 800,
        pageHeight: 900,
        blockedRequests: 2,
        bytes,
      }
    },
    async dispose() { disposed = true },
  }
  let saved: Uint8Array | undefined
  const ctx = {
    get(name: string) {
      if (name !== 'attachments') return undefined
      return {
        async saveImage(input: { data: Uint8Array; mediaType: 'image/png'; name: string }) {
          saved = input.data
          return {
            attachmentId: 'sha256:browser', mediaType: input.mediaType, bytes: input.data.byteLength,
            width: 800, height: 600, name: input.name,
          }
        },
      }
    },
  } as unknown as Context
  const result = await runVisionBrowserCapture({ url: 'https://example.com', wait_after_load_ms: 250 }, execution(), { ctx, config, browser })
  assert.deepEqual(capturedInput, { url: 'https://example.com', fullPage: false, waitAfterLoadMs: 250 })
  assert.equal(saved, bytes)
  assert.equal(result.attachment.attachmentId, 'sha256:browser')
  assert.equal(result.blockedRequests, 2)
  assert.equal('bytes' in result, false)
  await browser.dispose()
  assert.equal(disposed, true)
})

test('browser capture registers only when enabled and participates in plugin cleanup', async () => {
  const names: string[] = []
  let cleanup: (() => Promise<void>) | undefined
  const ctx = {
    logger: { info() {} },
    llm: { registerAdapter() { return () => {} } },
    tools: { register(definition: { name: string }) { names.push(definition.name); return () => {} } },
    get() { return undefined },
    effect(factory: () => () => Promise<void>) { cleanup = factory(); return () => {} },
  } as unknown as Context
  apply(ctx, config)
  assert.equal(names.at(-1), 'vision_browser_capture')
  assert.equal(names.length, 6)
  assert.ok(cleanup)
  await cleanup()
})
