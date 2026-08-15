import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SessionAttachmentIndex } from '../src/attachments.js'
import { LruTtlCache } from '../src/cache.js'
import type { Config } from '../src/config.js'
import { runVisionDescribe } from '../src/tool.js'
import type { VisionDescribeResult } from '../src/types.js'
import { VisionAdmissionAdapter } from '../src/wrapper-adapter.js'

function png2x3(): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([73, 72, 68, 82], 12)
  bytes.set([0, 0, 0, 2, 0, 0, 0, 3], 16)
  return bytes
}

const attachment = {
  attachmentId: 'sha256:integration',
  mediaType: 'image/png' as const,
  bytes: 24,
  width: 2,
  height: 3,
  name: 'screen.png',
}

test('visible wrapper advertises images, indexes refs, strips pixels, and delegates text reasoning', async () => {
  let delegated: GenerateOptions | undefined
  const llm = {
    async resolveModelInfo() {
      return {
        provider: 'deepseek-official',
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        inputModalities: ['text'],
        context: { contextWindow: 128000 },
      }
    },
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      delegated = options
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      })()
    },
  }
  const ctx = { llm } as unknown as Context
  const index = new SessionAttachmentIndex()
  const adapter = new VisionAdmissionAdapter(ctx, {
    wrapperRoute: 'deepseek-vision-workbench',
    textProvider: 'deepseek-official',
    textModel: 'deepseek-v4-pro',
  }, index)
  const info = await adapter.resolveModel('deepseek-vision-workbench', 'deepseek-v4-pro')
  assert.deepEqual(info.inputModalities, ['text', 'image'])
  const originalMessages = [{ role: 'user' as const, content: [{ type: 'image' as const, attachment }] }]
  const options = {
    provider: 'deepseek-vision-workbench',
    model: 'deepseek-v4-pro',
    sessionId: 'session-1',
    messages: originalMessages,
  } as GenerateOptions
  for await (const _chunk of adapter.stream(options)) { /* drain */ }
  assert.equal(delegated?.provider, 'deepseek-official')
  assert.equal(delegated?.model, 'deepseek-v4-pro')
  assert.match(JSON.stringify(delegated?.messages), /vision_describe/)
  assert.doesNotMatch(JSON.stringify(delegated?.messages), /"type":"image"/)
  assert.equal(originalMessages[0]?.content[0]?.type, 'image')
  assert.equal(index.get('session-1', attachment.attachmentId)?.name, 'screen.png')
})

test('vision_describe resolves a session attachment and reuses the bounded cache', async () => {
  const index = new SessionAttachmentIndex()
  index.remember('session-1', [{ content: [{ type: 'image', attachment }] }])
  const bytes = png2x3()
  const ctx = {
    get(name: string) {
      if (name !== 'attachments') return undefined
      return {
        async readImage() { return { ref: attachment, data: bytes } },
      }
    },
  } as unknown as Context
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
  let calls = 0
  const client = {
    cacheIdentity: 'primary:vision-model',
    async analyze() {
      calls += 1
      return {
        answer: 'settings page', text: 'Save', regions: [], warnings: [],
        provider: 'primary', model: 'vision-model', providerAttempts: 1, fallbackUsed: false,
      }
    },
  }
  const cache = new LruTtlCache<VisionDescribeResult>(10, 60_000)
  const exec = {
    signal: new AbortController().signal,
    agent: { session: { id: 'session-1', header: {} } },
  } as unknown as ToolRunContext
  const deps = { ctx, config, attachments: index, cache, client }
  const first = await runVisionDescribe({ attachment_ids: [attachment.attachmentId], question: 'what is this?' }, exec, deps)
  const second = await runVisionDescribe({ attachment_ids: [attachment.attachmentId], question: 'what is this?' }, exec, deps)
  assert.equal(first.answer, 'settings page')
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(calls, 1)
})
