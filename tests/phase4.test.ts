import assert from 'node:assert/strict'
import test from 'node:test'
import type { OpenAICompatibleVisionClient } from '../src/provider.js'
import { OpenAICompatibleVisionClient, VisionProviderError } from '../src/provider.js'
import { VisionProviderRouter } from '../src/routing.js'
import type { NamedVisionClient } from '../src/routing.js'
import type { VisionAnalysis } from '../src/types.js'

const analysis: VisionAnalysis = {
  answer: 'recognized',
  text: 'Save',
  regions: [],
  warnings: [],
}

function namedClient(
  name: string,
  model: string,
  analyze: Pick<OpenAICompatibleVisionClient, 'analyze'>['analyze'],
  onClose: () => void = () => undefined,
): NamedVisionClient {
  return {
    name,
    client: {
      model,
      analyze,
      async close() { onClose() },
    },
  }
}

test('provider router falls back in configured order and records the actual provider', async () => {
  const calls: string[] = []
  const router = new VisionProviderRouter([
    namedClient('primary', 'vision-a', async () => {
      calls.push('primary')
      throw new VisionProviderError('server', 'temporary upstream failure', 503)
    }),
    namedClient('backup', 'vision-b', async () => {
      calls.push('backup')
      return analysis
    }),
  ], { attemptTimeoutMs: 1000, failureThreshold: 2, cooldownMs: 60000 })

  const result = await router.analyze([], 'describe', true, new AbortController().signal)
  assert.deepEqual(calls, ['primary', 'backup'])
  assert.equal(result.provider, 'backup')
  assert.equal(result.model, 'vision-b')
  assert.equal(result.providerAttempts, 2)
  assert.equal(result.fallbackUsed, true)
  assert.equal(router.cacheIdentity, 'primary:vision-a|backup:vision-b')
})

test('circuit breaker skips a failed provider during cooldown and probes it after cooldown', async () => {
  let now = 1000
  let primaryCalls = 0
  let primaryHealthy = false
  const router = new VisionProviderRouter([
    namedClient('primary', 'vision-a', async () => {
      primaryCalls += 1
      if (!primaryHealthy) throw new VisionProviderError('network', 'offline')
      return analysis
    }),
    namedClient('backup', 'vision-b', async () => analysis),
  ], { attemptTimeoutMs: 1000, failureThreshold: 1, cooldownMs: 5000 }, () => now)

  const first = await router.analyze([], 'first', false, new AbortController().signal)
  assert.equal(first.provider, 'backup')
  const second = await router.analyze([], 'second', false, new AbortController().signal)
  assert.equal(second.provider, 'backup')
  assert.equal(second.providerAttempts, 1)
  assert.equal(primaryCalls, 1)

  now = 6001
  primaryHealthy = true
  const recovered = await router.analyze([], 'third', false, new AbortController().signal)
  assert.equal(recovered.provider, 'primary')
  assert.equal(recovered.fallbackUsed, false)
  assert.equal(primaryCalls, 2)
})

test('user cancellation stops routing without contacting a fallback', async () => {
  const controller = new AbortController()
  let fallbackCalls = 0
  const router = new VisionProviderRouter([
    namedClient('primary', 'vision-a', async () => {
      controller.abort(new Error('cancelled by user'))
      throw new Error('cancelled')
    }),
    namedClient('backup', 'vision-b', async () => {
      fallbackCalls += 1
      return analysis
    }),
  ], { attemptTimeoutMs: 1000, failureThreshold: 1, cooldownMs: 5000 })

  await assert.rejects(router.analyze([], 'question', false, controller.signal), /cancelled by user/)
  assert.equal(fallbackCalls, 0)
})

test('per-provider timeout advances to the next provider while total signal remains active', async () => {
  const router = new VisionProviderRouter([
    namedClient('slow', 'vision-slow', async (_images, _question, _structured, signal) =>
      new Promise<VisionAnalysis>((_resolve, reject) => {
        const aborted = () => reject(signal.reason ?? new Error('attempt timed out'))
        if (signal.aborted) aborted()
        else signal.addEventListener('abort', aborted, { once: true })
      })),
    namedClient('backup', 'vision-b', async () => analysis),
  ], { attemptTimeoutMs: 10, failureThreshold: 1, cooldownMs: 5000 })

  const result = await router.analyze([], 'question', false, new AbortController().signal)
  assert.equal(result.provider, 'backup')
  assert.equal(result.providerAttempts, 2)
})

test('aggregate failure exposes only provider identifiers and categories', async () => {
  const router = new VisionProviderRouter([
    namedClient('primary', 'vision-a', async () => { throw new Error('SECRET upstream body') }),
    namedClient('backup', 'vision-b', async () => {
      throw new VisionProviderError('authentication', 'credential reference PRIVATE_KEY failed', 401)
    }),
  ], { attemptTimeoutMs: 1000, failureThreshold: 1, cooldownMs: 5000 })

  await assert.rejects(
    router.analyze([], 'question', false, new AbortController().signal),
    (error: Error) => {
      assert.match(error.message, /primary:unknown, backup:authentication/)
      assert.doesNotMatch(error.message, /SECRET|PRIVATE_KEY/)
      return true
    },
  )
})

test('provider router closes every owned client', async () => {
  const closed: string[] = []
  const router = new VisionProviderRouter([
    namedClient('primary', 'vision-a', async () => analysis, () => closed.push('primary')),
    namedClient('backup', 'vision-b', async () => analysis, () => closed.push('backup')),
  ], { attemptTimeoutMs: 1000, failureThreshold: 1, cooldownMs: 5000 })
  await router.close()
  assert.deepEqual(closed, ['primary', 'backup'])
})

test('fallback crosses the OpenAI-compatible JSON wire boundary in order', async () => {
  const urls: string[] = []
  const primary = new OpenAICompatibleVisionClient({
    baseURL: 'https://primary.example/v1', model: 'vision-a', credentialRef: '',
    allowKeyless: true, maxTokens: 256, proxyUrl: '',
    async resolveCredential() { return undefined },
    async fetchImpl(url) {
      urls.push(url)
      return {
        ok: false, status: 503, headers: { get: () => null },
        async json() { return {} }, async text() { return 'unavailable' },
      }
    },
  })
  const backup = new OpenAICompatibleVisionClient({
    baseURL: 'https://backup.example/v1', model: 'vision-b', credentialRef: '',
    allowKeyless: true, maxTokens: 256, proxyUrl: '',
    async resolveCredential() { return undefined },
    async fetchImpl(url, init) {
      urls.push(url)
      assert.match(String(init.body), /"model":"vision-b"/)
      return {
        ok: true, status: 200, headers: { get: () => null },
        async json() { return { choices: [{ message: { content: 'backup answer' } }] } },
        async text() { return '' },
      }
    },
  })
  const router = new VisionProviderRouter([
    { name: 'primary', client: primary },
    { name: 'backup', client: backup },
  ], { attemptTimeoutMs: 1000, failureThreshold: 1, cooldownMs: 5000 })

  const result = await router.analyze([], 'question', false, new AbortController().signal)
  assert.deepEqual(urls, [
    'https://primary.example/v1/chat/completions',
    'https://backup.example/v1/chat/completions',
  ])
  assert.equal(result.answer, 'backup answer')
  assert.equal(result.provider, 'backup')
  await router.close()
})
