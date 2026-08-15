import type { LoadedImage } from './types.js'

export interface CropRegion {
  x: number
  y: number
  width: number
  height: number
}
export interface EncodedRaster {
  bytes: Uint8Array
  mediaType: 'image/png'
  width: number
  height: number
}

export interface CompareRasterResult {
  width: number
  height: number
  totalPixels: number
  changedPixels: number
  changedRatio: number
  meanAbsoluteDifference: number
  maxChannelDifference: number
  diff: EncodedRaster
}

export interface PaletteColor {
  hex: string
  red: number
  green: number
  blue: number
  pixels: number
  ratio: number
}

export interface RasterBackend {
  crop(image: LoadedImage, region: CropRegion): Promise<EncodedRaster>
  compare(before: LoadedImage, after: LoadedImage, tolerance: number): Promise<CompareRasterResult>
  palette(image: LoadedImage, count: number): Promise<PaletteColor[]>
}

type SharpFactory = typeof import('sharp').default
type SharpLoader = () => Promise<SharpFactory>

async function defaultSharpLoader(): Promise<SharpFactory> {
  try {
    return (await import('sharp')).default
  } catch (error) {
    throw new Error(
      'local raster processing is unavailable; install the optional sharp dependency for this Windows/Node architecture',
      { cause: error },
    )
  }
}

function assertWorkingPixels(width: number, height: number, maxWorkingPixels: number): void {
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > maxWorkingPixels) {
    throw new Error(`local raster operation exceeds the ${maxWorkingPixels}-pixel working limit`)
  }
}

function normalized(value: number): number {
  return Number(value.toFixed(8))
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0')
}

export class LazySharpRasterBackend implements RasterBackend {
  private factoryPromise: Promise<SharpFactory> | undefined

  constructor(
    private readonly maxWorkingPixels: number,
    private readonly loader: SharpLoader = defaultSharpLoader,
  ) {}

  private factory(): Promise<SharpFactory> {
    this.factoryPromise ??= this.loader()
    return this.factoryPromise
  }

  private async rawRgba(image: LoadedImage): Promise<{ data: Uint8Array; width: number; height: number }> {
    assertWorkingPixels(image.width, image.height, this.maxWorkingPixels)
    const sharp = await this.factory()
    const { data, info } = await sharp(image.bytes, {
      failOn: 'error',
      limitInputPixels: this.maxWorkingPixels,
      sequentialRead: true,
    })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 4) throw new Error(`unexpected decoded channel count ${info.channels}`)
    return { data, width: info.width, height: info.height }
  }

  async crop(image: LoadedImage, region: CropRegion): Promise<EncodedRaster> {
    assertWorkingPixels(region.width, region.height, this.maxWorkingPixels)
    const sharp = await this.factory()
    const { data, info } = await sharp(image.bytes, {
      failOn: 'error',
      limitInputPixels: this.maxWorkingPixels,
      sequentialRead: true,
    })
      .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true })
    return {
      bytes: data,
      mediaType: 'image/png',
      width: info.width,
      height: info.height,
    }
  }

  async compare(before: LoadedImage, after: LoadedImage, tolerance: number): Promise<CompareRasterResult> {
    if (before.width !== after.width || before.height !== after.height) {
      throw new Error(
        `vision_compare requires identical dimensions; received ${before.width}x${before.height} and ${after.width}x${after.height}`,
      )
    }
    assertWorkingPixels(before.width, before.height, this.maxWorkingPixels)
    const [left, right] = await Promise.all([this.rawRgba(before), this.rawRgba(after)])
    if (left.width !== right.width || left.height !== right.height) {
      throw new Error('decoded screenshot dimensions do not match')
    }
    const totalPixels = left.width * left.height
    const threshold = Math.round(tolerance * 255)
    const diff = new Uint8Array(totalPixels * 4)
    let changedPixels = 0
    let absoluteSum = 0
    let maxChannelDifference = 0
    for (let pixel = 0; pixel < totalPixels; pixel += 1) {
      const offset = pixel * 4
      let pixelDifference = 0
      for (let channel = 0; channel < 4; channel += 1) {
        const difference = Math.abs((left.data[offset + channel] ?? 0) - (right.data[offset + channel] ?? 0))
        absoluteSum += difference
        pixelDifference = Math.max(pixelDifference, difference)
        maxChannelDifference = Math.max(maxChannelDifference, difference)
      }
      if (pixelDifference > threshold) {
        changedPixels += 1
        diff[offset] = 255
        diff[offset + 1] = 0
        diff[offset + 2] = 255
      } else {
        const gray = Math.round(
          ((left.data[offset] ?? 0) + (left.data[offset + 1] ?? 0) + (left.data[offset + 2] ?? 0)) / 12,
        )
        diff[offset] = gray
        diff[offset + 1] = gray
        diff[offset + 2] = gray
      }
      diff[offset + 3] = 255
    }
    const sharp = await this.factory()
    const png = await sharp(diff, {
      raw: { width: left.width, height: left.height, channels: 4 },
    }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    return {
      width: left.width,
      height: left.height,
      totalPixels,
      changedPixels,
      changedRatio: normalized(changedPixels / totalPixels),
      meanAbsoluteDifference: normalized(absoluteSum / (totalPixels * 4 * 255)),
      maxChannelDifference,
      diff: {
        bytes: png,
        mediaType: 'image/png',
        width: left.width,
        height: left.height,
      },
    }
  }

  async palette(image: LoadedImage, count: number): Promise<PaletteColor[]> {
    assertWorkingPixels(image.width, image.height, this.maxWorkingPixels)
    const sharp = await this.factory()
    const { data, info } = await sharp(image.bytes, {
      failOn: 'error',
      limitInputPixels: this.maxWorkingPixels,
      sequentialRead: true,
    })
      .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true, kernel: 'nearest' })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 4) throw new Error(`unexpected decoded channel count ${info.channels}`)
    const buckets = new Map<number, number>()
    let visiblePixels = 0
    for (let offset = 0; offset < data.length; offset += 4) {
      if ((data[offset + 3] ?? 0) < 16) continue
      const red = (data[offset] ?? 0) >> 3
      const green = (data[offset + 1] ?? 0) >> 3
      const blue = (data[offset + 2] ?? 0) >> 3
      const key = (red << 10) | (green << 5) | blue
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
      visiblePixels += 1
    }
    if (visiblePixels === 0) return []
    return [...buckets.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, count)
      .map(([key, pixels]) => {
        const red = (((key >> 10) & 31) << 3) + 4
        const green = (((key >> 5) & 31) << 3) + 4
        const blue = ((key & 31) << 3) + 4
        return {
          hex: `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`,
          red,
          green,
          blue,
          pixels,
          ratio: normalized(pixels / visiblePixels),
        }
      })
  }
}

export function validateCropRegion(region: CropRegion, image: Pick<LoadedImage, 'width' | 'height'>): CropRegion {
  for (const [name, value] of Object.entries(region)) {
    if (!Number.isInteger(value)) throw new Error(`crop region ${name} must be an integer`)
  }
  if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0) {
    throw new Error('crop region must use non-negative x/y and positive width/height')
  }
  if (region.x + region.width > image.width || region.y + region.height > image.height) {
    throw new Error(`crop region exceeds the ${image.width}x${image.height} image bounds`)
  }
  return region
}
