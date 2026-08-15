export type SupportedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ImageAttachmentRefLike {
  attachmentId: string
  mediaType: SupportedImageMediaType | 'image/gif'
  bytes: number
  width: number
  height: number
  name?: string
}

export interface LoadedImage {
  id: string
  mediaType: SupportedImageMediaType
  bytes: Uint8Array
  width: number
  height: number
  name?: string
}

export interface VisionRegion {
  name: string
  description: string
  box?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface VisionAnalysis {
  answer: string
  text: string
  regions: VisionRegion[]
  warnings: string[]
}

export interface VisionDescribeResult extends VisionAnalysis {
  imageCount: number
  cached: boolean
  provider: string
  model: string
  providerAttempts: number
  fallbackUsed: boolean
}
