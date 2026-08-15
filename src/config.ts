import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type {
  Config as VisionWorkbenchConfig,
  VisionProviderConfig,
} from './config-types.js'

export type Config = VisionWorkbenchConfig
export type { VisionProviderConfig } from './config-types.js'

const visionProviderSchema: z<VisionProviderConfig> = z.object({
  name: z.string().default('primary'),
  baseURL: z.string().default(''),
  model: z.string().default(''),
  credentialRef: z.string().role('credential-ref').default('VISION_API_KEY'),
  allowKeyless: z.boolean().default(false),
  allowInsecureLocalhost: z.boolean().default(false),
  maxTokens: z.number().step(1).min(1).max(32768).default(4096),
})

export const Config: z<VisionWorkbenchConfig> = z.object({
  enabled: z.boolean().default(false),
  wrapperRoute: z.string().default('deepseek-vision-workbench'),
  textProvider: z
    .object({
      provider: z.string().default('deepseek-official'),
      model: z.string().default('deepseek-v4-pro'),
    })
    .default({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
  visionProvider: visionProviderSchema
    .default({
      name: 'primary',
      baseURL: '',
      model: '',
      credentialRef: 'VISION_API_KEY',
      allowKeyless: false,
      allowInsecureLocalhost: false,
      maxTokens: 4096,
    }),
  fallbackProviders: z.array(visionProviderSchema).max(3).default([]),
  providerRouting: z
    .object({
      attemptTimeoutMs: z.number().step(1).min(1000).max(120000).default(45000),
      failureThreshold: z.number().step(1).min(1).max(10).default(2),
      cooldownSeconds: z.number().step(1).min(1).max(3600).default(60),
    })
    .default({ attemptTimeoutMs: 45000, failureThreshold: 2, cooldownSeconds: 60 }),
  limits: z
    .object({
      maxImagesPerCall: z.number().step(1).min(1).max(4).default(4),
      maxImageBytes: z.number().step(1).min(1024).max(20 * 1024 * 1024).default(10 * 1024 * 1024),
      maxImagePixels: z.number().step(1).min(1).max(100_000_000).default(40_000_000),
    })
    .default({
      maxImagesPerCall: 4,
      maxImageBytes: 10 * 1024 * 1024,
      maxImagePixels: 40_000_000,
    }),
  cache: z
    .object({
      enabled: z.boolean().default(true),
      maxEntries: z.number().step(1).min(1).max(2000).default(200),
      ttlSeconds: z.number().step(1).min(0).max(86400).default(3600),
    })
    .default({ enabled: true, maxEntries: 200, ttlSeconds: 3600 }),
  localProcessing: z
    .object({
      enabled: z.boolean().default(true),
      maxWorkingPixels: z.number().step(1).min(1).max(40_000_000).default(16_000_000),
    })
    .default({ enabled: true, maxWorkingPixels: 16_000_000 }),
  localOcr: z
    .object({
      enabled: z.boolean().default(false),
      languagePath: z.string().default(''),
      languages: z.array(z.string()).min(1).max(4).default(['eng']),
      gzip: z.boolean().default(true),
      timeoutMs: z.number().step(1).min(1000).max(300000).default(60000),
      maxLanguageBytes: z.number().step(1).min(1024).max(200 * 1024 * 1024).default(50 * 1024 * 1024),
      maxRegions: z.number().step(1).min(1).max(200).default(50),
      pageSegMode: z.union(['auto', 'single-block', 'sparse-text'] as const).default('auto'),
      autoRotate: z.boolean().default(true),
      lowConfidenceThreshold: z.number().min(0).max(100).default(40),
    })
    .default({
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
    }),
  browserCapture: z
    .object({
      enabled: z.boolean().default(false),
      browserChannel: z.union(['msedge', 'chrome'] as const).default('msedge'),
      allowedHosts: z.array(z.string()).default([]),
      allowPrivateHosts: z.boolean().default(false),
      viewportWidth: z.number().step(1).min(320).max(3840).default(1440),
      viewportHeight: z.number().step(1).min(240).max(2160).default(900),
      maxPageHeight: z.number().step(1).min(240).max(30000).default(12000),
      navigationTimeoutMs: z.number().step(1).min(1000).max(120000).default(30000),
    })
    .default({
      enabled: false,
      browserChannel: 'msedge',
      allowedHosts: [],
      allowPrivateHosts: false,
      viewportWidth: 1440,
      viewportHeight: 900,
      maxPageHeight: 12000,
      navigationTimeoutMs: 30000,
    }),
  timeoutMs: z.number().step(1).min(1000).max(600000).default(120000),
  proxyUrl: z.string().default(''),
})

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function validateProvider(provider: VisionProviderConfig, path: string): void {
  const name = provider.name.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error(`vision-workbench: ${path}.name must be a safe identifier of 1-64 characters`)
  }
  if (provider.baseURL.trim().length === 0 || provider.model.trim().length === 0) {
    throw new Error(`vision-workbench: ${path}.baseURL and ${path}.model are required`)
  }
  let endpoint: URL
  try {
    endpoint = new URL(provider.baseURL)
  } catch {
    throw new Error(`vision-workbench: ${path}.baseURL must be a valid URL`)
  }
  if (endpoint.username || endpoint.password) {
    throw new Error(`vision-workbench: credentials must not be embedded in ${path}.baseURL`)
  }
  if (endpoint.protocol !== 'https:') {
    const allowedLocal = endpoint.protocol === 'http:'
      && provider.allowInsecureLocalhost
      && isLoopback(endpoint.hostname)
    if (!allowedLocal) {
      throw new Error(`vision-workbench: ${path}.baseURL must use HTTPS (HTTP is allowed only for an explicitly enabled loopback test server)`)
    }
  }
  if (!provider.allowKeyless && provider.credentialRef.trim().length === 0) {
    throw new Error(`vision-workbench: ${path}.credentialRef is required unless allowKeyless is explicitly enabled`)
  }
}

export function validateRuntimeConfig(config: VisionWorkbenchConfig): void {
  if (!config.enabled) return
  const wrapper = config.wrapperRoute.trim()
  const textProvider = config.textProvider.provider.trim()
  const textModel = config.textProvider.model.trim()
  if (wrapper.length === 0) throw new Error('vision-workbench: wrapperRoute must not be empty')
  if (wrapper === 'deepseek-official') {
    throw new Error('vision-workbench: wrapperRoute must not replace deepseek-official')
  }
  if (wrapper === textProvider) {
    throw new Error('vision-workbench: wrapperRoute must differ from textProvider.provider')
  }
  if (textProvider.length === 0 || textModel.length === 0) {
    throw new Error('vision-workbench: textProvider.provider and textProvider.model are required')
  }
  if (config.fallbackProviders.length > 3) {
    throw new Error('vision-workbench: fallbackProviders accepts at most three entries')
  }
  const providers = [config.visionProvider, ...config.fallbackProviders]
  const providerNames = new Set<string>()
  for (const [index, provider] of providers.entries()) {
    const path = index === 0 ? 'visionProvider' : `fallbackProviders[${index - 1}]`
    validateProvider(provider, path)
    const name = provider.name.trim()
    if (providerNames.has(name)) {
      throw new Error(`vision-workbench: duplicate vision provider name "${name}"`)
    }
    providerNames.add(name)
  }
  if (config.proxyUrl.trim().length > 0) {
    let proxy: URL
    try {
      proxy = new URL(config.proxyUrl)
    } catch {
      throw new Error('vision-workbench: proxyUrl must be a valid URL')
    }
    if (!['http:', 'https:'].includes(proxy.protocol)) {
      throw new Error('vision-workbench: proxyUrl must use http:// or https://')
    }
  }
  if (config.localOcr.enabled) {
    const languagePath = config.localOcr.languagePath.trim()
    if (languagePath.length === 0 || !isAbsolute(languagePath) || /^(?:https?|file):/i.test(languagePath)) {
      throw new Error('vision-workbench: localOcr.languagePath must be an absolute local filesystem path')
    }
    if (config.localOcr.languages.length < 1 || config.localOcr.languages.length > 4) {
      throw new Error('vision-workbench: localOcr.languages must contain one to four entries')
    }
    const languages = new Set<string>()
    for (const rawLanguage of config.localOcr.languages) {
      const language = rawLanguage.trim()
      if (!/^[A-Za-z0-9_]{1,32}$/.test(language)) {
        throw new Error(`vision-workbench: invalid localOcr.languages entry "${language}"`)
      }
      if (languages.has(language)) {
        throw new Error(`vision-workbench: duplicate localOcr.languages entry "${language}"`)
      }
      languages.add(language)
    }
  }
  if (config.browserCapture.enabled) {
    if (config.browserCapture.allowedHosts.length === 0) {
      throw new Error('vision-workbench: browserCapture.allowedHosts must contain at least one explicit hostname')
    }
    const normalized = new Set<string>()
    for (const rawHost of config.browserCapture.allowedHosts) {
      const host = rawHost.trim().toLowerCase()
      if (host.length === 0 || host.includes('/') || host.includes(':') || host.includes('*')) {
        throw new Error('vision-workbench: browserCapture.allowedHosts entries must be exact hostnames without scheme, port, path, or wildcard')
      }
      let parsedHost: string
      try {
        parsedHost = new URL(`https://${host}`).hostname.toLowerCase()
      } catch {
        throw new Error(`vision-workbench: invalid browserCapture.allowedHosts entry "${host}"`)
      }
      if (parsedHost !== host || host.endsWith('.')) {
        throw new Error(`vision-workbench: invalid browserCapture.allowedHosts entry "${host}"`)
      }
      if (normalized.has(host)) {
        throw new Error(`vision-workbench: duplicate browserCapture.allowedHosts entry "${host}"`)
      }
      normalized.add(host)
    }
  }
}
