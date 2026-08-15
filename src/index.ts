import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-tools'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SessionAttachmentIndex } from './attachments.js'
import { createVisionBrowserCaptureTool } from './browser-tool.js'
import { LazyPlaywrightBrowserCapture } from './browser.js'
import { LruTtlCache } from './cache.js'
import { Config as ConfigSchema, validateRuntimeConfig } from './config.js'
import type { Config as VisionWorkbenchConfig } from './config.js'
import { OpenAICompatibleVisionClient } from './provider.js'
import { VisionProviderRouter } from './routing.js'
import {
  createVisionCompareTool,
  createVisionCropTool,
  createVisionPaletteTool,
} from './local-tools.js'
import { createVisionOcrTool } from './ocr-tool.js'
import type { VisionOcrResult } from './ocr-tool.js'
import { LazyTesseractOcrBackend } from './local-ocr.js'
import { LazySharpRasterBackend } from './raster.js'
import { createVisionDescribeTool } from './tool.js'
import type { VisionDescribeResult } from './types.js'
import { VisionAdmissionAdapter } from './wrapper-adapter.js'

export const name = 'vision-workbench'
export const inject = ['tools', 'llm', 'attachments', 'settings']
export const Config = ConfigSchema
export type Config = VisionWorkbenchConfig
export const VISION_WORKBENCH_SETTINGS_NAMESPACE = settingsNamespace('vision-workbench')

export function apply(ctx: Context, entryConfig: VisionWorkbenchConfig): void {
  validateRuntimeConfig(entryConfig)

  // The native settings card is a first-class part of this plugin. Declaring
  // `settings` in `inject` guarantees that this apply function only runs after
  // the provider is ready, avoiding a race where the runtime mounts but its
  // settings namespace never becomes visible to the web UI.
  // Direct unit-test/minimal embedding contexts do not implement Cordis'
  // dependency gate. Retain the headless entry-config path for those callers.
  // In a real Harness context, service properties are exposed only inside the
  // scoped callback created by installSettingsSection(), so probing
  // `ctx.settings` here would incorrectly report the service as unavailable.
  if (typeof ctx.inject !== 'function') {
    applyRuntime(ctx, entryConfig)
    return
  }

  // Harness rc.5 only exposes arbitrary settings namespaces to Web clients
  // when an LLM configurable-provider directory entry owns them. This plugin
  // does own a configurable LLM wrapper route, so declaring its dormant route
  // is both truthful and the supported way to make the native card writable.
  const directory = typeof ctx.llm.registerConfigurableProviders === 'function'
    ? ctx.llm.registerConfigurableProviders([{
        provider: entryConfig.wrapperRoute.trim(),
        displayName: 'Vision Workbench',
        settingsNs: VISION_WORKBENCH_SETTINGS_NAMESPACE,
        settingsPath: [],
      }])
    : undefined

  let source: () => VisionWorkbenchConfig = () => entryConfig
  let runtimeApplied = false
  installSettingsSection(ctx, VISION_WORKBENCH_SETTINGS_NAMESPACE, ConfigSchema, entryConfig, {
    validate: validateRuntimeConfig,
    setSource: current => { source = current },
    onChange: () => {
      // Tool and adapter registrations are structural. A committed settings
      // change is persisted immediately but intentionally takes effect on the
      // next profile start, as the card tells the user.
      if (runtimeApplied) return
      runtimeApplied = true
      const resolved = source()
      directory?.replace([{
        provider: resolved.wrapperRoute.trim(),
        displayName: 'Vision Workbench',
        settingsNs: VISION_WORKBENCH_SETTINGS_NAMESPACE,
        settingsPath: [],
      }])
      applyRuntime(ctx, resolved)
    },
  })
}

function applyRuntime(ctx: Context, config: VisionWorkbenchConfig): void {
  validateRuntimeConfig(config)
  if (!config.enabled) {
    ctx.logger?.info('vision-workbench is installed but disabled; configure a vision provider before enabling it')
    return
  }

  const attachmentIndex = new SessionAttachmentIndex(100, config.limits.maxImagesPerCall * 20)
  const cache = new LruTtlCache<VisionDescribeResult>(
    config.cache.maxEntries,
    config.cache.ttlSeconds * 1000,
  )
  const ocrCache = new LruTtlCache<VisionOcrResult>(
    config.cache.maxEntries,
    config.cache.ttlSeconds * 1000,
  )
  const raster = new LazySharpRasterBackend(config.localProcessing.maxWorkingPixels)
  const localOcr = new LazyTesseractOcrBackend(config.localOcr)
  const browser = new LazyPlaywrightBrowserCapture(
    config.browserCapture,
    Math.min(config.limits.maxImagePixels, 40_000_000),
  )
  const resolveCredential = async (ref: string): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    return (await credentials.resolve(credentialRef(ref)))?.value
  }
  const providers = [config.visionProvider, ...config.fallbackProviders].map(provider => ({
    name: provider.name.trim(),
    client: new OpenAICompatibleVisionClient({
      baseURL: provider.baseURL.trim(),
      model: provider.model.trim(),
      credentialRef: provider.credentialRef.trim(),
      allowKeyless: provider.allowKeyless,
      maxTokens: provider.maxTokens,
      proxyUrl: config.proxyUrl.trim(),
      resolveCredential,
    }),
  }))
  const client = new VisionProviderRouter(providers, {
    attemptTimeoutMs: config.providerRouting.attemptTimeoutMs,
    failureThreshold: config.providerRouting.failureThreshold,
    cooldownMs: config.providerRouting.cooldownSeconds * 1000,
  })

  ctx.llm.registerAdapter(
    [config.wrapperRoute.trim()],
    new VisionAdmissionAdapter(ctx, {
      wrapperRoute: config.wrapperRoute.trim(),
      textProvider: config.textProvider.provider.trim(),
      textModel: config.textProvider.model.trim(),
    }, attachmentIndex),
  )
  ctx.tools.register(createVisionDescribeTool({
    ctx,
    config,
    attachments: attachmentIndex,
    cache,
    client,
  }))
  const localToolDependencies = { ctx, config, attachments: attachmentIndex, raster }
  if (config.localProcessing.enabled) {
    ctx.tools.register(createVisionCropTool(localToolDependencies))
    ctx.tools.register(createVisionCompareTool(localToolDependencies))
    ctx.tools.register(createVisionPaletteTool(localToolDependencies))
  }
  ctx.tools.register(createVisionOcrTool({
    ...localToolDependencies,
    cache: ocrCache,
    client,
    localOcr,
  }))
  if (config.browserCapture.enabled) {
    ctx.tools.register(createVisionBrowserCaptureTool({ ctx, config, browser }))
  }

  ctx.effect(() => async () => {
    attachmentIndex.clear()
    cache.clear()
    ocrCache.clear()
    await browser.dispose()
    await localOcr.dispose()
    await client.close()
  }, 'vision-workbench: resources')
}

export {
  SessionAttachmentIndex,
  collectImageRefs,
  rewriteImagesForTextModel,
} from './attachments.js'
export { LruTtlCache } from './cache.js'
export { BrowserRequestPolicy, isPrivateAddress, parseBrowserUrl } from './browser-policy.js'
export { LazyPlaywrightBrowserCapture } from './browser.js'
export { createVisionBrowserCaptureTool, runVisionBrowserCapture } from './browser-tool.js'
export { inspectRaster } from './image.js'
export { loadSingleImage } from './image-source.js'
export { LazyTesseractOcrBackend } from './local-ocr.js'
export type { LocalOcrBackend, LocalOcrRecognition, TesseractLoader } from './local-ocr.js'
export {
  createVisionCompareTool,
  createVisionCropTool,
  createVisionPaletteTool,
  runVisionCompare,
  runVisionCrop,
  runVisionPalette,
} from './local-tools.js'
export { createVisionOcrTool, runVisionOcr } from './ocr-tool.js'
export { normalizeVisionAnswer, OpenAICompatibleVisionClient } from './provider.js'
export { VisionProviderError } from './provider.js'
export { VisionProviderRouter } from './routing.js'
export { LazySharpRasterBackend, validateCropRegion } from './raster.js'
export { runVisionDescribe } from './tool.js'
export { VisionAdmissionAdapter } from './wrapper-adapter.js'
