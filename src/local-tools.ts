import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SessionAttachmentIndex } from './attachments.js'
import type { Config } from './config.js'
import { loadSingleImage } from './image-source.js'
import type {
  CompareRasterResult,
  CropRegion,
  PaletteColor,
  RasterBackend,
} from './raster.js'
import { validateCropRegion } from './raster.js'

interface LocalToolDependencies {
  ctx: Context
  config: Config
  attachments: SessionAttachmentIndex
  raster: RasterBackend
}

export interface VisionCropArgs {
  attachment_id?: string
  path?: string
  region: CropRegion
}

export interface VisionCropResult {
  source: string
  sourceWidth: number
  sourceHeight: number
  region: CropRegion
  attachment: ImageAttachmentRef
}

export interface VisionCompareArgs {
  before: { attachment_id?: string; path?: string }
  after: { attachment_id?: string; path?: string }
  tolerance?: number
}

export interface VisionCompareResult extends Omit<CompareRasterResult, 'diff'> {
  tolerance: number
  before: string
  after: string
  diffAttachment: ImageAttachmentRef
}

export interface VisionPaletteArgs {
  attachment_id?: string
  path?: string
  count?: number
}

export interface VisionPaletteResult {
  source: string
  width: number
  height: number
  colors: PaletteColor[]
}

function assertLocalEnabled(config: Config): void {
  if (!config.localProcessing.enabled) {
    throw new Error('local raster processing is disabled by localProcessing.enabled')
  }
}

async function savePng(ctx: Context, bytes: Uint8Array, name: string): Promise<ImageAttachmentRef> {
  const store = ctx.get('attachments')
  if (store === undefined) throw new Error('the attachment service is not available')
  return store.saveImage({ data: bytes, mediaType: 'image/png', name })
}

export async function runVisionCrop(
  args: VisionCropArgs,
  exec: ToolRunContext,
  dependencies: LocalToolDependencies,
): Promise<VisionCropResult> {
  assertLocalEnabled(dependencies.config)
  const image = await loadSingleImage(args, exec, dependencies.ctx, dependencies.config, dependencies.attachments)
  const region = validateCropRegion(args.region, image)
  const cropped = await dependencies.raster.crop(image, region)
  const attachment = await savePng(dependencies.ctx, cropped.bytes, 'vision-crop.png')
  return {
    source: image.id,
    sourceWidth: image.width,
    sourceHeight: image.height,
    region,
    attachment,
  }
}

export async function runVisionCompare(
  args: VisionCompareArgs,
  exec: ToolRunContext,
  dependencies: LocalToolDependencies,
): Promise<VisionCompareResult> {
  assertLocalEnabled(dependencies.config)
  const tolerance = args.tolerance ?? 0.02
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
    throw new Error('vision_compare tolerance must be between 0 and 1')
  }
  const [before, after] = await Promise.all([
    loadSingleImage(args.before, exec, dependencies.ctx, dependencies.config, dependencies.attachments),
    loadSingleImage(args.after, exec, dependencies.ctx, dependencies.config, dependencies.attachments),
  ])
  const comparison = await dependencies.raster.compare(before, after, tolerance)
  const diffAttachment = await savePng(dependencies.ctx, comparison.diff.bytes, 'vision-diff.png')
  return {
    width: comparison.width,
    height: comparison.height,
    totalPixels: comparison.totalPixels,
    changedPixels: comparison.changedPixels,
    changedRatio: comparison.changedRatio,
    meanAbsoluteDifference: comparison.meanAbsoluteDifference,
    maxChannelDifference: comparison.maxChannelDifference,
    tolerance,
    before: before.id,
    after: after.id,
    diffAttachment,
  }
}

export async function runVisionPalette(
  args: VisionPaletteArgs,
  exec: ToolRunContext,
  dependencies: LocalToolDependencies,
): Promise<VisionPaletteResult> {
  assertLocalEnabled(dependencies.config)
  const count = args.count ?? 5
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error('vision_palette count must be an integer from 1 through 12')
  }
  const image = await loadSingleImage(args, exec, dependencies.ctx, dependencies.config, dependencies.attachments)
  return {
    source: image.id,
    width: image.width,
    height: image.height,
    colors: await dependencies.raster.palette(image, count),
  }
}

const sourceParameters = {
  attachment_id: {
    type: 'string',
    description: 'One durable attachment id from an image marker. Mutually exclusive with path.',
  },
  path: {
    type: 'string',
    description: 'One workspace PNG/JPEG/WebP path. Mutually exclusive with attachment_id.',
  },
} as const

const regionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'integer', required: true },
    y: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
  },
} as const

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

function derivedImageContent<T>(value: T, attachment: ImageAttachmentRef): Array<
  { type: 'text'; text: string } | { type: 'image'; attachment: ImageAttachmentRef }
> {
  return [
    { type: 'text', text: JSON.stringify(value) },
    { type: 'image', attachment },
  ]
}

export function createVisionCropTool(dependencies: LocalToolDependencies) {
  return defineTool({
    name: 'vision_crop',
    description:
      'Crop one screenshot or image by exact pixel coordinates. The derived PNG is stored as a durable attachment '
      + 'that can be passed to vision_describe or vision_ocr. Coordinates are relative to the encoded image top-left.',
    parameters: {
      ...sourceParameters,
      region: { ...regionSchema, required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          sourceWidth: { type: 'number', required: true },
          sourceHeight: { type: 'number', required: true },
          region: { ...regionSchema, required: true },
          attachment: { ...attachmentSchema, required: true },
        },
      },
      render: (_args, value) => derivedImageContent(value, value.attachment as ImageAttachmentRef),
      presentationMeta: (_args, value) => ({
        source: value.source,
        width: value.attachment.width,
        height: value.attachment.height,
      }),
    },
    async execute(args, exec) {
      return runVisionCrop(args, exec, dependencies)
    },
    presentCall: () => ({ card: 'generic', title: 'Crop image region', kind: 'read' }),
  })
}

export function createVisionCompareTool(dependencies: LocalToolDependencies) {
  return defineTool({
    name: 'vision_compare',
    description:
      'Compare two same-size screenshots pixel by pixel. Returns changed-pixel metrics and a durable PNG where '
      + 'changed pixels are magenta. It intentionally refuses dimension mismatch instead of silently resizing.',
    parameters: {
      before: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: sourceParameters,
      },
      after: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: sourceParameters,
      },
      tolerance: {
        type: 'number',
        description: 'Normalized per-channel threshold from 0 through 1. Defaults to 0.02.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          width: { type: 'number', required: true },
          height: { type: 'number', required: true },
          totalPixels: { type: 'number', required: true },
          changedPixels: { type: 'number', required: true },
          changedRatio: { type: 'number', required: true },
          meanAbsoluteDifference: { type: 'number', required: true },
          maxChannelDifference: { type: 'number', required: true },
          tolerance: { type: 'number', required: true },
          before: { type: 'string', required: true },
          after: { type: 'string', required: true },
          diffAttachment: { ...attachmentSchema, required: true },
        },
      },
      render: (_args, value) => derivedImageContent(value, value.diffAttachment as ImageAttachmentRef),
      presentationMeta: (_args, value) => ({
        changedPixels: value.changedPixels,
        changedRatio: value.changedRatio,
        tolerance: value.tolerance,
      }),
    },
    async execute(args, exec) {
      return runVisionCompare(args, exec, dependencies)
    },
    presentCall: () => ({ card: 'generic', title: 'Compare screenshots', kind: 'read' }),
  })
}

export function createVisionPaletteTool(dependencies: LocalToolDependencies) {
  return defineTool({
    name: 'vision_palette',
    description:
      'Extract a deterministic approximate dominant-color palette locally. Transparent pixels are ignored and '
      + 'colors are quantized to stable 5-bit RGB buckets.',
    parameters: {
      ...sourceParameters,
      count: { type: 'integer', description: 'Number of colors from 1 through 12. Defaults to 5.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          width: { type: 'number', required: true },
          height: { type: 'number', required: true },
          colors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hex: { type: 'string', required: true },
                red: { type: 'number', required: true },
                green: { type: 'number', required: true },
                blue: { type: 'number', required: true },
                pixels: { type: 'number', required: true },
                ratio: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => ({ colorCount: value.colors.length }),
    },
    async execute(args, exec) {
      return runVisionPalette(args, exec, dependencies)
    },
    presentCall: () => ({ card: 'generic', title: 'Extract image palette', kind: 'read' }),
  })
}
