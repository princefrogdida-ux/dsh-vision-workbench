import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SessionAttachmentIndex } from './attachments.js'
import type { Config } from './config.js'
import { loadAttachmentImage, loadWorkspaceImage } from './image.js'
import type { LoadedImage } from './types.js'

export interface SingleImageSourceArgs {
  attachment_id?: string
  path?: string
}
export function sessionIdOf(exec: ToolRunContext): string | undefined {
  const session = exec.agent?.session as { id?: unknown } | undefined
  return session?.id === undefined ? undefined : String(session.id)
}

export function sessionCwdOf(exec: ToolRunContext): string | undefined {
  const session = exec.agent?.session as { header?: { cwd?: unknown } } | undefined
  return typeof session?.header?.cwd === 'string' && session.header.cwd.length > 0
    ? session.header.cwd
    : undefined
}

export async function loadSingleImage(
  args: SingleImageSourceArgs,
  exec: ToolRunContext,
  ctx: Context,
  config: Config,
  attachments: SessionAttachmentIndex,
): Promise<LoadedImage> {
  const attachmentId = args.attachment_id?.trim()
  const imagePath = args.path?.trim()
  if ((attachmentId === undefined || attachmentId.length === 0) === (imagePath === undefined || imagePath.length === 0)) {
    throw new Error('provide exactly one of attachment_id or path')
  }
  const limits = {
    maxImageBytes: config.limits.maxImageBytes,
    maxImagePixels: config.limits.maxImagePixels,
  }
  if (attachmentId !== undefined && attachmentId.length > 0) {
    const ref = attachments.get(sessionIdOf(exec), attachmentId)
    if (ref === undefined) {
      throw new Error(`unknown attachment id "${attachmentId}"; use an id shown in the current conversation's image marker`)
    }
    return loadAttachmentImage(ctx, ref, limits, exec.signal)
  }
  return loadWorkspaceImage(ctx, imagePath as string, sessionCwdOf(exec), limits, exec.signal)
}
