import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeVisionAnswer, OpenAICompatibleVisionClient, VisionProviderError } from '../src/provider.js'

test('normalizes structured evidence and preserves invalid raw output', () => {
  assert.deepEqual(
    normalizeVisionAnswer('{"summary":"settings","text":"Save","regions":[{"name":"footer","description":"save button"}]}', true),
    {
      answer: 'settings',
      text: 'Save',
      regions: [{ name: 'footer', description: 'save button' }],
      warnings: [],
    },
  )
  const fallback = normalizeVisionAnswer('plain answer', true)
  assert.equal(fallback.answer, 'plain answer')
  assert.equal(fallback.warnings.length, 1)
  assert.deepEqual(
    normalizeVisionAnswer('{"summary":"ocr","text":"Save","regions":[{"name":"button","description":"Save","box":[10,20,30,40]}]}', true).regions,
    [{ name: 'button', description: 'Save', box: { x: 10, y: 20, width: 30, height: 40 } }],
  )
})

test('provider sends selected image and credential without logging or global fetch patching', async () => {
  let capturedUrl = ''
  let capturedInit: Record<string, unknown> | undefined
  const originalFetch = globalThis.fetch
  const client = new OpenAICompatibleVisionClient({
    baseURL: 'https://vision.example/v1',
    model: 'vision-model',
    credentialRef: 'VISION_KEY',
    allowKeyless: false,
    maxTokens: 256,
    proxyUrl: '',
    async resolveCredential() { return '  secret-value  ' },
    async fetchImpl(url, init) {
      capturedUrl = url
      capturedInit = init
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() {
          return { choices: [{ message: { content: 'a screenshot' } }] }
        },
        async text() { return '' },
      }
    },
  })
  const result = await client.analyze([{
    id: 'image-1',
    mediaType: 'image/png',
    bytes: Uint8Array.from([1, 2, 3]),
    width: 1,
    height: 1,
  }], 'describe it', false, new AbortController().signal)
  assert.equal(result.answer, 'a screenshot')
  assert.equal(capturedUrl, 'https://vision.example/v1/chat/completions')
  const headers = capturedInit?.headers as Record<string, string>
  assert.equal(headers.authorization, 'Bearer secret-value')
  assert.match(String(capturedInit?.body), /data:image\/png;base64,AQID/)
  assert.equal(globalThis.fetch, originalFetch)
  await client.close()
})

test('provider retries one 429 response and then succeeds', async () => {
  let calls = 0
  const client = new OpenAICompatibleVisionClient({
    baseURL: 'https://vision.example/v1',
    model: 'vision-model',
    credentialRef: '',
    allowKeyless: true,
    maxTokens: 256,
    proxyUrl: '',
    async resolveCredential() { return undefined },
    async fetchImpl() {
      calls += 1
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => '0.001' },
          async json() { return {} },
          async text() { return 'rate limited' },
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() { return { choices: [{ message: { content: 'retried' } }] } },
        async text() { return '' },
      }
    },
  })
  const result = await client.analyze([], 'describe', false, new AbortController().signal)
  assert.equal(result.answer, 'retried')
  assert.equal(calls, 2)
})

test('provider rejects a missing required credential before network I/O', async () => {
  let called = false
  const client = new OpenAICompatibleVisionClient({
    baseURL: 'https://vision.example/v1',
    model: 'vision-model',
    credentialRef: 'MISSING',
    allowKeyless: false,
    maxTokens: 256,
    proxyUrl: '',
    async resolveCredential() { return undefined },
    async fetchImpl() {
      called = true
      throw new Error('should not run')
    },
  })
  await assert.rejects(
    client.analyze([], 'question', false, new AbortController().signal),
    /is not configured/,
  )
  assert.equal(called, false)
})

test('provider classifies HTTP failures for safe routing decisions', async () => {
  const client = new OpenAICompatibleVisionClient({
    baseURL: 'https://vision.example/v1',
    model: 'vision-model',
    credentialRef: '',
    allowKeyless: true,
    maxTokens: 256,
    proxyUrl: '',
    async resolveCredential() { return undefined },
    async fetchImpl() {
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        async json() { return {} },
        async text() { return 'maintenance' },
      }
    },
  })
  await assert.rejects(
    client.analyze([], 'question', false, new AbortController().signal),
    (error: Error) => {
      assert.ok(error instanceof VisionProviderError)
      assert.equal(error.category, 'server')
      assert.equal(error.status, 503)
      return true
    },
  )
})
