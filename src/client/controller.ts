import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import {
  createSnapshotStore,
  type SettingsScope,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { Config } from '../config-types.js'

export interface CredentialView {
  configured: boolean
  writable: boolean
}

export interface CredentialSnapshot {
  loading: boolean
  refs: Readonly<Record<string, CredentialView>>
}

export interface VisionWorkbenchCardFace {
  hooks: {
    settings: SettingsScope<Config>
    credentials: SnapshotStore<CredentialSnapshot>
  }
  inspectCredentials: (refs: readonly string[]) => void
  save: (next: Config, secrets: Readonly<Record<string, string>>) => Promise<void>
}

export class VisionWorkbenchCardController {
  private readonly credentialStore = createSnapshotStore<CredentialSnapshot>({
    loading: false,
    refs: {},
  })

  private inspectedRefs: readonly string[] = []
  private readGeneration = 0

  constructor(
    private readonly scope: SettingsScope<Config>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {}

  inject(): VisionWorkbenchCardFace {
    return {
      hooks: {
        settings: this.scope,
        credentials: this.credentialStore,
      },
      inspectCredentials: refs => this.inspectCredentials(refs),
      save: (next, secrets) => this.save(next, secrets),
    }
  }

  inspectCredentials(refs: readonly string[]): void {
    const normalized = [...new Set(refs.map(ref => ref.trim()).filter(Boolean))].sort()
    if (normalized.length === this.inspectedRefs.length
      && normalized.every((ref, index) => ref === this.inspectedRefs[index])) return
    this.inspectedRefs = normalized
    void this.readCredentials(normalized)
  }

  refreshCredential(ref: string): void {
    if (!this.inspectedRefs.includes(ref)) return
    void this.readCredentials(this.inspectedRefs)
  }

  private async readCredentials(refs: readonly string[]): Promise<void> {
    const generation = ++this.readGeneration
    this.credentialStore.update((draft) => {
      draft.loading = true
    })
    try {
      if (refs.length === 0) {
        this.credentialStore.set({ loading: false, refs: {} })
        return
      }
      const response = await this.api.credentials.describe({ refs: [...refs] })
      if (generation !== this.readGeneration || !response.result.ok) return
      const views: Record<string, CredentialView> = {}
      for (const ref of refs) {
        const view = response.result.value.credentials[ref]
        views[ref] = {
          configured: view?.configured ?? false,
          writable: view?.writable ?? true,
        }
      }
      this.credentialStore.set({ loading: false, refs: views })
    } catch {
      if (generation !== this.readGeneration) return
      this.credentialStore.update((draft) => {
        draft.loading = false
      })
    }
  }

  private async save(next: Config, secrets: Readonly<Record<string, string>>): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) {
      throw new Error('vision-workbench settings are not writable')
    }

    // Cross-field validation is intentionally strict while enabled. Stage a
    // temporary disabled value so endpoint/model/ref changes can land as one
    // logical form save, then publish the requested enabled state last.
    await this.scope.set('enabled', false)
    for (const [field, value] of Object.entries(next)) {
      if (field === 'enabled') continue
      await this.scope.set(field, value)
    }
    await this.scope.set('enabled', next.enabled)

    for (const [ref, value] of Object.entries(secrets)) {
      const normalizedRef = ref.trim()
      if (normalizedRef.length === 0 || value.length === 0) continue
      const response = await this.api.credentials.set({ ref: normalizedRef, value })
      if (!response.result.ok) throw new Error(`credential write refused for ${normalizedRef}`)
    }
    if (JSON.stringify(this.scope.getSnapshot().value) !== JSON.stringify(next)) {
      throw new Error('vision-workbench settings were rejected by Host validation')
    }
    await this.readCredentials(this.inspectedRefs)
  }
}
