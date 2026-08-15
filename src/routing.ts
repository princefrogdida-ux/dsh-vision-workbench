import type { OpenAICompatibleVisionClient, VisionFailureCategory } from './provider.js'
import { VisionProviderError } from './provider.js'
import type { LoadedImage, VisionAnalysis } from './types.js'

export interface NamedVisionClient {
  name: string
  client: Pick<OpenAICompatibleVisionClient, 'analyze' | 'close' | 'model'>
}

export interface RoutedVisionAnalysis extends VisionAnalysis {
  provider: string
  model: string
  providerAttempts: number
  fallbackUsed: boolean
}

export interface VisionRouterLike {
  readonly cacheIdentity: string
  analyze(
    images: readonly LoadedImage[],
    question: string,
    structured: boolean,
    signal: AbortSignal,
  ): Promise<RoutedVisionAnalysis>
}

interface CircuitState {
  failures: number
  openUntil: number
}

export interface VisionProviderRouterOptions {
  attemptTimeoutMs: number
  failureThreshold: number
  cooldownMs: number
}

function failureCategory(error: unknown, attemptSignal: AbortSignal): VisionFailureCategory {
  if (attemptSignal.aborted) return 'timeout'
  return error instanceof VisionProviderError ? error.category : 'unknown'
}

export class VisionProviderRouter implements VisionRouterLike {
  private readonly states: CircuitState[]
  readonly cacheIdentity: string

  constructor(
    private readonly providers: readonly NamedVisionClient[],
    private readonly options: VisionProviderRouterOptions,
    private readonly now: () => number = Date.now,
  ) {
    if (providers.length === 0) throw new Error('vision provider router requires at least one provider')
    this.states = providers.map(() => ({ failures: 0, openUntil: 0 }))
    this.cacheIdentity = providers.map(provider => `${provider.name}:${provider.client.model}`).join('|')
  }

  async analyze(
    images: readonly LoadedImage[],
    question: string,
    structured: boolean,
    signal: AbortSignal,
  ): Promise<RoutedVisionAnalysis> {
    signal.throwIfAborted()
    const now = this.now()
    let candidates = this.providers
      .map((_provider, index) => index)
      .filter(index => (this.states[index] as CircuitState).openUntil <= now)
    if (candidates.length === 0) {
      const earliest = this.states.reduce((best, state, index, states) =>
        state.openUntil < (states[best] as CircuitState).openUntil ? index : best, 0)
      candidates = [earliest]
    }

    const failures: string[] = []
    let attempts = 0
    for (const index of candidates) {
      signal.throwIfAborted()
      const provider = this.providers[index] as NamedVisionClient
      const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(this.options.attemptTimeoutMs)])
      attempts += 1
      try {
        const analysis = await provider.client.analyze(images, question, structured, attemptSignal)
        this.states[index] = { failures: 0, openUntil: 0 }
        return {
          ...analysis,
          provider: provider.name,
          model: provider.client.model,
          providerAttempts: attempts,
          fallbackUsed: index > 0,
        }
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error
        const category = failureCategory(error, attemptSignal)
        const state = this.states[index] as CircuitState
        const failureCount = state.failures + 1
        this.states[index] = failureCount >= this.options.failureThreshold
          ? { failures: 0, openUntil: this.now() + this.options.cooldownMs }
          : { failures: failureCount, openUntil: 0 }
        failures.push(`${provider.name}:${category}`)
      }
    }
    throw new Error(`all configured vision providers failed (${failures.join(', ')})`)
  }

  async close(): Promise<void> {
    await Promise.all(this.providers.map(provider => provider.client.close()))
  }
}
