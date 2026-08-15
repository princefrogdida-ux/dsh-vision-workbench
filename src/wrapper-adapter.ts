import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { rewriteImagesForTextModel, SessionAttachmentIndex } from './attachments.js'

export interface WrapperAdapterOptions {
  wrapperRoute: string
  textProvider: string
  textModel: string
}

export class VisionAdmissionAdapter extends LlmAdapter {
  constructor(
    private readonly ctx: Context,
    private readonly options: WrapperAdapterOptions,
    private readonly attachments: SessionAttachmentIndex,
  ) {
    super()
  }

  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: 'DeepSeek + Vision Workbench' }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const resolved = await this.resolveModel(provider, this.options.textModel)
    return [{
      provider,
      id: resolved.id,
      name: resolved.name,
      ...(resolved.description === undefined ? {} : { description: resolved.description }),
      inputModalities: ['text', 'image'],
    }]
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    if (model !== this.options.textModel) {
      throw new LlmError(
        `vision-workbench exposes only the configured text model "${this.options.textModel}"`,
        'UNSUPPORTED',
      )
    }
    const delegate = await this.ctx.llm.resolveModelInfo(this.options.textProvider, this.options.textModel, signal)
    return {
      provider,
      id: model,
      name: `${delegate.name} + Vision`,
      description: 'Text reasoning by the configured DeepSeek model with on-demand vision tools.',
      inputModalities: ['text', 'image'],
      ...(delegate.context === undefined ? {} : { context: delegate.context }),
      ...(delegate.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: delegate.defaultMaxTokens }),
      ...(delegate.reasoning === undefined ? {} : { reasoning: delegate.reasoning }),
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId)
    this.attachments.remember(sessionId, options.messages)
    const messages = rewriteImagesForTextModel(options.messages)
    yield* this.ctx.llm.stream({
      ...options,
      provider: this.options.textProvider,
      model: this.options.textModel,
      messages: [...messages],
    })
  }
}
