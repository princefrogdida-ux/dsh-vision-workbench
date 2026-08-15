import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from './config.js'
import type { LoadedImage, VisionRegion } from './types.js'

interface TesseractBlock {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

interface TesseractWorker {
  setParameters(parameters: Record<string, string>): Promise<unknown>
  recognize(
    image: Buffer,
    options: { rotateAuto: boolean },
    output: { text: true; blocks: true },
  ): Promise<{
    data: {
      text: string
      confidence: number
      blocks: TesseractBlock[] | null
    }
  }>
  terminate(): Promise<unknown>
}

interface TesseractApi {
  createWorker(
    languages: string[],
    oem: string,
    options: {
      langPath: string
      gzip: boolean
      cacheMethod: 'none'
      logger: (message: unknown) => void
      errorHandler: (error: unknown) => void
    },
  ): Promise<TesseractWorker>
  OEM: { LSTM_ONLY: string }
  PSM: { AUTO: string; SINGLE_BLOCK: string; SPARSE_TEXT: string }
}

export interface LocalOcrRecognition {
  text: string
  confidence: number
  regions: VisionRegion[]
  warnings: string[]
}

export interface LocalOcrBackend {
  readonly enabled: boolean
  readonly languages: readonly string[]
  readonly cacheIdentity: string
  recognize(image: LoadedImage, signal: AbortSignal): Promise<LocalOcrRecognition>
  dispose(): Promise<void>
}

export type TesseractLoader = () => Promise<TesseractApi>

function createAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException('Local OCR was aborted', 'AbortError')
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal, onAbort: () => Promise<void>): Promise<T> {
  if (signal.aborted) {
    return onAbort().then(() => Promise.reject(createAbortError(signal)))
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const abort = () => {
      if (settled) return
      settled = true
      void onAbort().then(
        () => reject(createAbortError(signal)),
        () => reject(createAbortError(signal)),
      )
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      error => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

async function loadTesseract(): Promise<TesseractApi> {
  let imported: unknown
  try {
    imported = await import('tesseract.js')
  } catch (error) {
    throw new Error(
      'Local OCR requires the optional dependency tesseract.js. Reinstall the plugin with optional dependencies enabled.',
      { cause: error },
    )
  }
  return imported as TesseractApi
}

function pageSegMode(api: TesseractApi, mode: Config['localOcr']['pageSegMode']): string {
  if (mode === 'single-block') return api.PSM.SINGLE_BLOCK
  if (mode === 'sparse-text') return api.PSM.SPARSE_TEXT
  return api.PSM.AUTO
}

function clampBox(block: TesseractBlock, image: LoadedImage): NonNullable<VisionRegion['box']> {
  const x0 = Math.max(0, Math.min(image.width, Math.round(block.bbox.x0)))
  const y0 = Math.max(0, Math.min(image.height, Math.round(block.bbox.y0)))
  const x1 = Math.max(x0, Math.min(image.width, Math.round(block.bbox.x1)))
  const y1 = Math.max(y0, Math.min(image.height, Math.round(block.bbox.y1)))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export class LazyTesseractOcrBackend implements LocalOcrBackend {
  readonly enabled: boolean
  readonly languages: readonly string[]
  readonly cacheIdentity: string
  private readonly config: Config['localOcr']
  private readonly loader: TesseractLoader
  private workerPromise: Promise<TesseractWorker> | undefined
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(config: Config['localOcr'], loader: TesseractLoader = loadTesseract) {
    this.config = {
      ...config,
      languagePath: config.languagePath.trim(),
      languages: config.languages.map(language => language.trim()),
    }
    this.enabled = config.enabled
    this.loader = loader
    this.languages = this.config.languages
    const identityHash = createHash('sha256')
      .update(this.config.languagePath)
      .digest('hex')
      .slice(0, 12)
    this.cacheIdentity = [
      'local-tesseract-v1',
      this.languages.join('+'),
      this.config.gzip ? 'gzip' : 'plain',
      this.config.pageSegMode,
      this.config.autoRotate ? 'rotate' : 'fixed',
      identityHash,
    ].join(':')
  }

  recognize(image: LoadedImage, signal: AbortSignal): Promise<LocalOcrRecognition> {
    const operation = this.queue.then(() => this.recognizeExclusive(image, signal))
    this.queue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async recognizeExclusive(image: LoadedImage, signal: AbortSignal): Promise<LocalOcrRecognition> {
    if (!this.enabled) throw new Error('Local OCR is disabled; set localOcr.enabled before using backend=local')
    if (this.disposed) throw new Error('Local OCR backend has been disposed')
    if (signal.aborted) throw createAbortError(signal)
    const worker = await raceWithAbort(this.getWorker(), signal, () => this.terminateWorker())
    const recognition = worker.recognize(
      Buffer.from(image.bytes),
      { rotateAuto: this.config.autoRotate },
      { text: true, blocks: true },
    )
    const result = await raceWithAbort(recognition, signal, () => this.terminateWorker())
    const text = result.data.text.replace(/\s+$/u, '')
    const blocks = result.data.blocks ?? []
    const warnings: string[] = []
    if (text.length === 0) warnings.push('Local OCR did not detect any text.')
    if (result.data.confidence < this.config.lowConfidenceThreshold) {
      warnings.push(
        `Local OCR confidence ${result.data.confidence.toFixed(1)} is below the configured threshold `
        + `${this.config.lowConfidenceThreshold.toFixed(1)}.`,
      )
    }
    if (blocks.length > this.config.maxRegions) {
      warnings.push(`Local OCR returned ${blocks.length} text blocks; regions were limited to ${this.config.maxRegions}.`)
    }
    const regions = blocks.slice(0, this.config.maxRegions).map((block, index): VisionRegion => ({
      name: `text-block-${index + 1}`,
      description: block.text.trim().slice(0, 1000),
      box: clampBox(block, image),
    }))
    return {
      text,
      confidence: result.data.confidence,
      regions,
      warnings,
    }
  }

  private async getWorker(): Promise<TesseractWorker> {
    if (this.workerPromise === undefined) this.workerPromise = this.createWorker()
    try {
      return await this.workerPromise
    } catch (error) {
      this.workerPromise = undefined
      throw error
    }
  }

  private async createWorker(): Promise<TesseractWorker> {
    const directory = await stat(this.config.languagePath)
    if (!directory.isDirectory()) {
      throw new Error(`Local OCR languagePath is not a directory: ${this.config.languagePath}`)
    }
    const suffix = this.config.gzip ? '.traineddata.gz' : '.traineddata'
    for (const language of this.languages) {
      const filePath = join(this.config.languagePath, `${language}${suffix}`)
      let file
      try {
        file = await stat(filePath)
      } catch (error) {
        throw new Error(`Local OCR language file is missing: ${filePath}`, { cause: error })
      }
      if (!file.isFile() || file.size === 0) {
        throw new Error(`Local OCR language file is not a non-empty regular file: ${filePath}`)
      }
      if (file.size > this.config.maxLanguageBytes) {
        throw new Error(
          `Local OCR language file exceeds maxLanguageBytes (${file.size} > ${this.config.maxLanguageBytes}): ${filePath}`,
        )
      }
    }
    const api = await this.loader()
    const worker = await api.createWorker([...this.languages], api.OEM.LSTM_ONLY, {
      langPath: this.config.languagePath,
      gzip: this.config.gzip,
      cacheMethod: 'none',
      logger: () => undefined,
      errorHandler: () => undefined,
    })
    try {
      await worker.setParameters({ tessedit_pageseg_mode: pageSegMode(api, this.config.pageSegMode) })
      if (this.disposed) throw new Error('Local OCR backend was disposed during worker startup')
      return worker
    } catch (error) {
      await worker.terminate().catch(() => undefined)
      throw error
    }
  }

  private async terminateWorker(): Promise<void> {
    const workerPromise = this.workerPromise
    this.workerPromise = undefined
    if (workerPromise === undefined) return
    try {
      const worker = await workerPromise
      await worker.terminate()
    } catch {
      // Startup or termination failures are already surfaced by the active operation.
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.terminateWorker()
  }
}
