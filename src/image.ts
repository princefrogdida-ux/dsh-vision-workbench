import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import type { ImageAttachmentRefLike, LoadedImage, SupportedImageMediaType } from './types.js'

export interface ImageLimits {
  maxImageBytes: number
  maxImagePixels: number
}

export interface ImageDimensions {
  mediaType: SupportedImageMediaType
  width: number
  height: number
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)) >>> 0
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function inspectPng(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24) return undefined
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)) return undefined
  if (ascii(bytes, 12, 4) !== 'IHDR') throw new Error('invalid PNG: IHDR is missing')
  return { mediaType: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) }
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function inspectJpeg(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    const segmentLength = u16be(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw new Error('invalid JPEG segment length')
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new Error('invalid JPEG SOF segment')
      return {
        mediaType: 'image/jpeg',
        height: u16be(bytes, offset + 3),
        width: u16be(bytes, offset + 5),
      }
    }
    offset += segmentLength
  }
  throw new Error('invalid JPEG: dimensions were not found')
}

function inspectWebp(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return undefined
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') {
    return {
      mediaType: 'image/webp',
      width: u24le(bytes, 24) + 1,
      height: u24le(bytes, 27) + 1,
    }
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) throw new Error('invalid lossless WebP signature')
    const b1 = bytes[21] ?? 0
    const b2 = bytes[22] ?? 0
    const b3 = bytes[23] ?? 0
    const b4 = bytes[24] ?? 0
    return {
      mediaType: 'image/webp',
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    }
  }
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new Error('invalid lossy WebP frame header')
    }
    return {
      mediaType: 'image/webp',
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    }
  }
  throw new Error(`unsupported WebP chunk ${chunk || '(empty)'}`)
}

export function inspectRaster(bytes: Uint8Array): ImageDimensions {
  const inspected = inspectPng(bytes) ?? inspectJpeg(bytes) ?? inspectWebp(bytes)
  if (inspected === undefined) throw new Error('unsupported image format; expected PNG, JPEG, or WebP')
  if (!Number.isInteger(inspected.width) || inspected.width <= 0
    || !Number.isInteger(inspected.height) || inspected.height <= 0) {
    throw new Error('invalid image dimensions')
  }
  return inspected
}

export function enforceImageLimits(bytes: Uint8Array, dimensions: ImageDimensions, limits: ImageLimits): void {
  if (bytes.byteLength > limits.maxImageBytes) {
    throw new Error(`image exceeds the ${limits.maxImageBytes}-byte limit`)
  }
  const pixels = dimensions.width * dimensions.height
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxImagePixels) {
    throw new Error(`image exceeds the ${limits.maxImagePixels}-pixel limit`)
  }
}

export async function loadAttachmentImage(
  ctx: Context,
  ref: ImageAttachmentRefLike,
  limits: ImageLimits,
  signal: AbortSignal,
): Promise<LoadedImage> {
  if (ref.mediaType === 'image/gif') throw new Error('GIF is not supported in phase 1; convert it to PNG, JPEG, or WebP')
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('the attachment service is not available')
  // The session log owns the branded attachment id. The internal transport
  // shape stays serializable and recovers the public brand only at this seam.
  const stored = await attachments.readImage(ref as ImageAttachmentRef, signal)
  const dimensions = inspectRaster(stored.data)
  enforceImageLimits(stored.data, dimensions, limits)
  if (dimensions.mediaType !== stored.ref.mediaType
    || dimensions.width !== stored.ref.width
    || dimensions.height !== stored.ref.height) {
    throw new Error(`attachment metadata mismatch for ${ref.attachmentId}`)
  }
  return {
    id: String(stored.ref.attachmentId),
    mediaType: dimensions.mediaType,
    bytes: stored.data,
    width: dimensions.width,
    height: dimensions.height,
    ...(stored.ref.name === undefined ? {} : { name: stored.ref.name }),
  }
}

export async function loadWorkspaceImage(
  ctx: Context,
  imagePath: string,
  cwd: string | undefined,
  limits: ImageLimits,
  signal: AbortSignal,
): Promise<LoadedImage> {
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('the filesystem service is not available for path-based images')
  const target = await fs.resolve(imagePath, { ...(cwd === undefined ? {} : { cwd }), signal })
  const bytes = await fs.readBytes(target, signal, limits.maxImageBytes)
  const dimensions = inspectRaster(bytes)
  enforceImageLimits(bytes, dimensions, limits)
  return {
    id: `path:${target.displayPath}`,
    mediaType: dimensions.mediaType,
    bytes,
    width: dimensions.width,
    height: dimensions.height,
    name: basename(target.displayPath),
  }
}
