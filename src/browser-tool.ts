import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { BrowserCaptureBackend } from './browser.js'
import type { Config } from './config.js'
import { enforceImageLimits, inspectRaster } from './image.js'

export interface VisionBrowserCaptureArgs {
  url: string
  full_page?: boolean
  wait_after_load_ms?: number
}

export interface VisionBrowserCaptureResult {
  requestedUrl: string
  finalUrl: string
  title: string
  status?: number
  fullPage: boolean
  viewportWidth: number
  viewportHeight: number
  pageWidth: number
  pageHeight: number
  blockedRequests: number
  attachment: ImageAttachmentRef
}

interface BrowserToolDependencies {
  ctx: Context
  config: Config
  browser: BrowserCaptureBackend
}

export async function runVisionBrowserCapture(
  args: VisionBrowserCaptureArgs,
  exec: ToolRunContext,
  dependencies: BrowserToolDependencies,
): Promise<VisionBrowserCaptureResult> {
  if (!dependencies.config.browserCapture.enabled) {
    throw new Error('browser capture is disabled by browserCapture.enabled')
  }
  const waitAfterLoadMs = args.wait_after_load_ms ?? 0
  if (!Number.isInteger(waitAfterLoadMs) || waitAfterLoadMs < 0 || waitAfterLoadMs > 5000) {
    throw new Error('vision_browser_capture wait_after_load_ms must be an integer from 0 through 5000')
  }
  const raw = await dependencies.browser.capture({
    url: args.url,
    fullPage: args.full_page ?? false,
    waitAfterLoadMs,
  }, exec.signal)
  const limits = {
    maxImageBytes: dependencies.config.limits.maxImageBytes,
    maxImagePixels: dependencies.config.limits.maxImagePixels,
  }
  const inspected = inspectRaster(raw.bytes)
  enforceImageLimits(raw.bytes, inspected, limits)
  if (inspected.mediaType !== 'image/png') throw new Error('browser backend returned a non-PNG screenshot')
  const store = dependencies.ctx.get('attachments')
  if (store === undefined) throw new Error('the attachment service is not available')
  const attachment = await store.saveImage({
    data: raw.bytes,
    mediaType: 'image/png',
    name: 'vision-browser-capture.png',
  })
  const { bytes: _bytes, ...metadata } = raw
  return { ...metadata, attachment }
}

const attachmentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'number', required: true },
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
    name: { type: 'string' },
  },
} as const

export function createVisionBrowserCaptureTool(dependencies: BrowserToolDependencies) {
  return defineTool({
    name: 'vision_browser_capture',
    description:
      'Open one explicitly allowlisted HTTP(S) URL in a fresh headless Edge/Chrome context and save a PNG screenshot '
      + 'as a durable attachment. This tool does not reuse browser profiles, click elements, submit forms, or preserve cookies.',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute http:// or https:// URL on an allowed hostname.' },
      full_page: { type: 'boolean', description: 'Capture the full scrollable page. Defaults to false.' },
      wait_after_load_ms: { type: 'integer', description: 'Additional deterministic wait after DOMContentLoaded, 0-5000 ms.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requestedUrl: { type: 'string', required: true },
          finalUrl: { type: 'string', required: true },
          title: { type: 'string', required: true },
          status: { type: 'number' },
          fullPage: { type: 'boolean', required: true },
          viewportWidth: { type: 'number', required: true },
          viewportHeight: { type: 'number', required: true },
          pageWidth: { type: 'number', required: true },
          pageHeight: { type: 'number', required: true },
          blockedRequests: { type: 'number', required: true },
          attachment: { ...attachmentSchema, required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value) },
        { type: 'image', attachment: value.attachment as ImageAttachmentRef },
      ],
      presentationMeta: (_args, value) => ({
        finalUrl: value.finalUrl,
        width: value.attachment.width,
        height: value.attachment.height,
        blockedRequests: value.blockedRequests,
      }),
    },
    async execute(args, exec) {
      return runVisionBrowserCapture(args, exec, dependencies)
    },
    presentCall: () => ({ card: 'generic', title: 'Capture webpage screenshot', kind: 'read' }),
  })
}
