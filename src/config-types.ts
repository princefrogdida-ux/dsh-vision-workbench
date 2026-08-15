export interface VisionProviderConfig {
  name: string
  baseURL: string
  model: string
  credentialRef: string
  allowKeyless: boolean
  allowInsecureLocalhost: boolean
  maxTokens: number
}

export interface Config {
  enabled: boolean
  wrapperRoute: string
  textProvider: {
    provider: string
    model: string
  }
  visionProvider: VisionProviderConfig
  fallbackProviders: VisionProviderConfig[]
  providerRouting: {
    attemptTimeoutMs: number
    failureThreshold: number
    cooldownSeconds: number
  }
  limits: {
    maxImagesPerCall: number
    maxImageBytes: number
    maxImagePixels: number
  }
  cache: {
    enabled: boolean
    maxEntries: number
    ttlSeconds: number
  }
  localProcessing: {
    enabled: boolean
    maxWorkingPixels: number
  }
  localOcr: {
    enabled: boolean
    languagePath: string
    languages: string[]
    gzip: boolean
    timeoutMs: number
    maxLanguageBytes: number
    maxRegions: number
    pageSegMode: 'auto' | 'single-block' | 'sparse-text'
    autoRotate: boolean
    lowConfidenceThreshold: number
  }
  browserCapture: {
    enabled: boolean
    browserChannel: 'msedge' | 'chrome'
    allowedHosts: string[]
    allowPrivateHosts: boolean
    viewportWidth: number
    viewportHeight: number
    maxPageHeight: number
    navigationTimeoutMs: number
  }
  timeoutMs: number
  proxyUrl: string
}
