import { lookup } from 'node:dns/promises'
import type { Browser, BrowserContext, Route, WebSocketRoute } from 'playwright-core'
import type { Config } from './config.js'
import { BrowserRequestPolicy } from './browser-policy.js'

export interface BrowserCaptureInput {
  url: string
  fullPage: boolean
  waitAfterLoadMs: number
}

export interface RawBrowserCapture {
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
  bytes: Uint8Array
}

export interface BrowserCaptureBackend {
  capture(input: BrowserCaptureInput, signal: AbortSignal): Promise<RawBrowserCapture>
  dispose(): Promise<void>
}

type ChromiumApi = {
  launch(options: { channel: 'msedge' | 'chrome'; headless: true }): Promise<Browser>
}

export class LazyPlaywrightBrowserCapture implements BrowserCaptureBackend {
  private readonly active = new Set<Browser>()

  constructor(
    private readonly config: Config['browserCapture'],
    private readonly maxCapturePixels: number,
    private readonly loadChromium: () => Promise<ChromiumApi> = async () => {
      try {
        return (await import('playwright-core')).chromium
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`browser capture backend is unavailable; install optional dependency playwright-core (${detail})`)
      }
    },
  ) {}

  async capture(input: BrowserCaptureInput, signal: AbortSignal): Promise<RawBrowserCapture> {
    signal.throwIfAborted()
    const policy = new BrowserRequestPolicy(this.config, async hostname => {
      const entries = await lookup(hostname, { all: true, verbatim: true })
      return entries.map(entry => entry.address)
    })
    const requestedUrl = (await policy.assertAllowed(input.url)).href
    const chromium = await this.loadChromium()
    signal.throwIfAborted()
    const browser = await chromium.launch({ channel: this.config.browserChannel, headless: true })
    this.active.add(browser)
    const abort = () => { void browser.close().catch(() => undefined) }
    signal.addEventListener('abort', abort, { once: true })
    let context: BrowserContext | undefined
    let blockedRequests = 0
    try {
      context = await browser.newContext({
        viewport: { width: this.config.viewportWidth, height: this.config.viewportHeight },
        acceptDownloads: false,
        serviceWorkers: 'block',
      })
      context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs)
      context.setDefaultTimeout(this.config.navigationTimeoutMs)
      await context.route('**/*', async (route: Route) => {
        try {
          await policy.assertAllowed(route.request().url())
          await route.continue()
        } catch {
          blockedRequests += 1
          await route.abort('blockedbyclient')
        }
      })
      await context.routeWebSocket(/.*/, async (socket: WebSocketRoute) => {
        try {
          await policy.assertAllowed(socket.url())
          socket.connectToServer()
        } catch {
          blockedRequests += 1
          socket.close()
        }
      })
      const page = await context.newPage()
      page.on('dialog', dialog => { void dialog.dismiss() })
      const response = await page.goto(requestedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.navigationTimeoutMs,
      })
      if (input.waitAfterLoadMs > 0) await page.waitForTimeout(input.waitAfterLoadMs)
      signal.throwIfAborted()
      const finalUrl = (await policy.assertAllowed(page.url())).href
      const pageSize = await page.evaluate(() => ({
        width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      }))
      const captureWidth = input.fullPage ? pageSize.width : this.config.viewportWidth
      const captureHeight = input.fullPage ? pageSize.height : this.config.viewportHeight
      if (captureHeight > this.config.maxPageHeight) {
        throw new Error(`vision_browser_capture page height ${captureHeight}px exceeds browserCapture.maxPageHeight ${this.config.maxPageHeight}px`)
      }
      const capturePixels = captureWidth * captureHeight
      if (!Number.isSafeInteger(capturePixels) || capturePixels > this.maxCapturePixels) {
        throw new Error(`vision_browser_capture would create ${capturePixels} pixels; the configured limit is ${this.maxCapturePixels}`)
      }
      const bytes = await page.screenshot({
        type: 'png',
        fullPage: input.fullPage,
        animations: 'disabled',
        caret: 'hide',
        timeout: this.config.navigationTimeoutMs,
      })
      return {
        requestedUrl,
        finalUrl,
        title: await page.title(),
        ...(response === null ? {} : { status: response.status() }),
        fullPage: input.fullPage,
        viewportWidth: this.config.viewportWidth,
        viewportHeight: this.config.viewportHeight,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        blockedRequests,
        bytes,
      }
    } finally {
      signal.removeEventListener('abort', abort)
      if (context !== undefined) await context.close().catch(() => undefined)
      await browser.close().catch(() => undefined)
      this.active.delete(browser)
    }
  }

  async dispose(): Promise<void> {
    const active = [...this.active]
    this.active.clear()
    await Promise.all(active.map(browser => browser.close().catch(() => undefined)))
  }
}
