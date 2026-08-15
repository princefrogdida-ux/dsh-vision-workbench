import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Config } from '../config-types.js'
import { VisionWorkbenchCard } from './VisionWorkbenchCard.js'
import { VisionWorkbenchCardController } from './controller.js'
import { en, zh } from './locales.js'

const NS = 'vision.workbench'
const SETTINGS_NAMESPACE = 'vision-workbench'

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind<Config>({ namespace: SETTINGS_NAMESPACE })
  const controller = new VisionWorkbenchCardController(scope, api)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'vision-workbench: client dictionaries')
  ctx.effect(
    () => ctx.remote.$on('credentials/updated', ref => controller.refreshCredential(ref)),
    'vision-workbench: credential invalidations',
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'vision-workbench',
    order: 30,
    locale: NS,
    inject: () => controller.inject(),
  }, VisionWorkbenchCard))
}

export type { VisionWorkbenchCardFace, CredentialSnapshot, CredentialView } from './controller.js'
