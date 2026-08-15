import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { Config, VisionProviderConfig } from '../config-types.js'
import type { VisionWorkbenchCardFace } from './controller.js'
import type { LocaleKey } from './locales.js'
import css from './VisionWorkbenchCard.module.css'

export type VisionWorkbenchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'vision.workbench'>
  & InjectFace<VisionWorkbenchCardFace>

type Translator = (key: LocaleKey) => string

function TextField(props: {
  id: string
  label: string
  value: string
  disabled: boolean
  type?: 'text' | 'password'
  placeholder?: string
  status?: ReactNode
  hint?: string
  onChange: (value: string) => void
}) {
  return (
    <label className={css.field} htmlFor={props.id}>
      <span className={css.fieldHead}>
        <span className={css.label}>{props.label}</span>
        {props.status}
      </span>
      <input
        id={props.id}
        className={css.input}
        type={props.type ?? 'text'}
        autoComplete={props.type === 'password' ? 'off' : undefined}
        value={props.value}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={event => props.onChange(event.target.value)}
      />
      {props.hint ? <span className={css.hint}>{props.hint}</span> : null}
    </label>
  )
}

function NumberField(props: {
  id: string
  label: string
  value: number
  disabled: boolean
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <label className={css.field} htmlFor={props.id}>
      <span className={css.label}>{props.label}</span>
      <input
        id={props.id}
        className={css.input}
        type="number"
        value={props.value}
        disabled={props.disabled}
        min={props.min}
        max={props.max}
        onChange={event => props.onChange(Number(event.target.value))}
      />
    </label>
  )
}

function Toggle(props: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className={css.toggle}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={event => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  )
}

function Group(props: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className={css.group} open={props.open ?? true}>
      <summary>{props.title}</summary>
      <div className={css.grid}>{props.children}</div>
    </details>
  )
}

function ProviderEditor(props: {
  id: string
  title: string
  provider: VisionProviderConfig
  secret: string
  configured: boolean
  credentialWritable: boolean
  disabled: boolean
  removable: boolean
  t: Translator
  onChange: (next: VisionProviderConfig) => void
  onSecret: (value: string) => void
  onRemove: () => void
}) {
  const update = <K extends keyof VisionProviderConfig>(key: K, value: VisionProviderConfig[K]) => {
    props.onChange({ ...props.provider, [key]: value })
  }
  return (
    <div className={css.provider}>
      <div className={css.providerHead}>
        <strong>{props.title}</strong>
        {props.removable
          ? <button type="button" className={css.remove} disabled={props.disabled} onClick={props.onRemove}>{props.t('removeFallback')}</button>
          : null}
      </div>
      <div className={css.grid}>
        <TextField id={`${props.id}-name`} label={props.t('name')} value={props.provider.name} disabled={props.disabled} onChange={value => update('name', value)} />
        <TextField id={`${props.id}-model`} label={props.t('model')} value={props.provider.model} disabled={props.disabled} onChange={value => update('model', value)} />
        <div className={css.span2}>
          <TextField id={`${props.id}-base-url`} label={props.t('baseURL')} value={props.provider.baseURL} disabled={props.disabled} placeholder="https://…/v1" onChange={value => update('baseURL', value)} />
        </div>
        <TextField id={`${props.id}-credential-ref`} label={props.t('credentialRef')} value={props.provider.credentialRef} disabled={props.disabled} placeholder="VISION_API_KEY" onChange={value => update('credentialRef', value)} />
        <TextField
          id={`${props.id}-api-key`}
          label={props.t('apiKey')}
          value={props.secret}
          type="password"
          disabled={props.disabled || !props.credentialWritable}
          status={<span className={props.configured ? css.badge : css.badgeMuted}>{props.t(props.configured ? 'configured' : 'notConfigured')}</span>}
          hint={props.t('apiKeyHint')}
          onChange={props.onSecret}
        />
        <NumberField id={`${props.id}-max-tokens`} label={props.t('maxTokens')} value={props.provider.maxTokens} disabled={props.disabled} min={1} max={32768} onChange={value => update('maxTokens', value)} />
        <div className={css.toggles}>
          <Toggle label={props.t('allowKeyless')} checked={props.provider.allowKeyless} disabled={props.disabled} onChange={value => update('allowKeyless', value)} />
          <Toggle label={props.t('allowInsecureLocalhost')} checked={props.provider.allowInsecureLocalhost} disabled={props.disabled} onChange={value => update('allowInsecureLocalhost', value)} />
        </div>
      </div>
    </div>
  )
}

function cloneConfig(config: Config): Config {
  return structuredClone(config)
}

function defaultFallback(index: number): VisionProviderConfig {
  const ordinal = index + 1
  return {
    name: `fallback-${ordinal}`,
    baseURL: '',
    model: '',
    credentialRef: `VISION_FALLBACK_${ordinal}_API_KEY`,
    allowKeyless: false,
    allowInsecureLocalhost: false,
    maxTokens: 4096,
  }
}

export function VisionWorkbenchCard(props: VisionWorkbenchCardProps) {
  const settings = props.useSettings(snapshot => snapshot)
  const credentials = props.useCredentials(snapshot => snapshot)
  const t = props.t as Translator
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Config | undefined>(undefined)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<'idle' | 'saved' | 'failed'>('idle')

  useEffect(() => {
    if (settings.value === undefined || dirty) return
    setDraft(cloneConfig(settings.value))
  }, [settings.value, settings.revision, dirty])

  const refs = useMemo(() => {
    if (draft === undefined) return []
    return [draft.visionProvider, ...draft.fallbackProviders]
      .map(provider => provider.credentialRef.trim())
      .filter(Boolean)
  }, [draft])
  const refsKey = refs.join('\u0000')
  useEffect(() => {
    props.inspectCredentials(refs)
  }, [refsKey])

  if (settings.status === 'unavailable') return null
  const title = t('title')
  const disabled = !settings.writable || saving

  const edit = (mutator: (next: Config) => void) => {
    if (draft === undefined) return
    const next = cloneConfig(draft)
    mutator(next)
    setDraft(next)
    setDirty(true)
    setResult('idle')
  }
  const credentialOf = (ref: string) => credentials.refs[ref.trim()] ?? { configured: false, writable: true }
  const discard = () => {
    if (settings.value !== undefined) setDraft(cloneConfig(settings.value))
    setSecrets({})
    setDirty(false)
    setResult('idle')
  }
  const save = async () => {
    if (draft === undefined) return
    const writes: Record<string, string> = {}
    const providers = [draft.visionProvider, ...draft.fallbackProviders]
    providers.forEach((provider, index) => {
      const value = secrets[index === 0 ? 'primary' : `fallback-${index - 1}`]
      if (value && provider.credentialRef.trim()) writes[provider.credentialRef.trim()] = value
    })
    setSaving(true)
    setResult('idle')
    try {
      await props.save(draft, writes)
      setSecrets({})
      setDirty(false)
      setResult('saved')
    } catch {
      setResult('failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={`${css.card} ${open ? css.cardOpen : ''}`}>
      <button type="button" className={css.header} aria-expanded={open} aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`} onClick={() => setOpen(!open)}>
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{t('description')}</span>
        </span>
        {dirty ? <span className={css.pending}>{t('unsaved')}</span> : null}
        <span className={`${css.chevron} ${open ? css.chevronOpen : ''}`} aria-hidden>⌄</span>
      </button>
      {open ? (
        <div className={css.body}>
          {settings.status === 'loading' || draft === undefined ? <p className={css.notice}>{t('unavailable')}</p> : (
            <>
              {!settings.writable ? <p className={css.notice}>{t('readOnly')}</p> : null}
              <p className={css.notice}>{t('restart')}</p>

              <Group title={t('general')} open>
                <div className={css.span2}><Toggle label={t('enabled')} checked={draft.enabled} disabled={disabled} onChange={value => edit(next => { next.enabled = value })} /></div>
                <TextField id="vision-wrapper-route" label={t('wrapperRoute')} value={draft.wrapperRoute} disabled={disabled} onChange={value => edit(next => { next.wrapperRoute = value })} />
              </Group>

              <Group title={t('text')}>
                <TextField id="vision-text-provider" label={t('textProvider')} value={draft.textProvider.provider} disabled={disabled} onChange={value => edit(next => { next.textProvider.provider = value })} />
                <TextField id="vision-text-model" label={t('textModel')} value={draft.textProvider.model} disabled={disabled} onChange={value => edit(next => { next.textProvider.model = value })} />
              </Group>

              <Group title={t('primary')} open>
                <div className={css.span2}>
                  <ProviderEditor
                    id="vision-primary"
                    title={t('primary')}
                    provider={draft.visionProvider}
                    secret={secrets.primary ?? ''}
                    configured={credentialOf(draft.visionProvider.credentialRef).configured}
                    credentialWritable={credentialOf(draft.visionProvider.credentialRef).writable}
                    disabled={disabled}
                    removable={false}
                    t={t}
                    onChange={provider => edit(next => { next.visionProvider = provider })}
                    onSecret={value => { setSecrets(current => ({ ...current, primary: value })); setDirty(true); setResult('idle') }}
                    onRemove={() => {}}
                  />
                </div>
              </Group>

              <Group title={t('fallback')}>
                <div className={css.span2}>
                  {draft.fallbackProviders.map((provider, index) => (
                    <ProviderEditor
                      key={`${index}-${provider.name}`}
                      id={`vision-fallback-${index}`}
                      title={`${t('fallback')} ${index + 1}`}
                      provider={provider}
                      secret={secrets[`fallback-${index}`] ?? ''}
                      configured={credentialOf(provider.credentialRef).configured}
                      credentialWritable={credentialOf(provider.credentialRef).writable}
                      disabled={disabled}
                      removable
                      t={t}
                      onChange={value => edit(next => { next.fallbackProviders[index] = value })}
                      onSecret={value => { setSecrets(current => ({ ...current, [`fallback-${index}`]: value })); setDirty(true); setResult('idle') }}
                      onRemove={() => { edit(next => { next.fallbackProviders.splice(index, 1) }); setSecrets({}) }}
                    />
                  ))}
                  {draft.fallbackProviders.length < 3
                    ? <button type="button" className={css.add} disabled={disabled} onClick={() => edit(next => { next.fallbackProviders.push(defaultFallback(next.fallbackProviders.length)) })}>{t('addFallback')}</button>
                    : null}
                </div>
              </Group>

              <Group title={t('routing')}>
                <NumberField id="vision-attempt-timeout" label={t('attemptTimeoutMs')} value={draft.providerRouting.attemptTimeoutMs} disabled={disabled} min={1000} max={120000} onChange={value => edit(next => { next.providerRouting.attemptTimeoutMs = value })} />
                <NumberField id="vision-failure-threshold" label={t('failureThreshold')} value={draft.providerRouting.failureThreshold} disabled={disabled} min={1} max={10} onChange={value => edit(next => { next.providerRouting.failureThreshold = value })} />
                <NumberField id="vision-cooldown" label={t('cooldownSeconds')} value={draft.providerRouting.cooldownSeconds} disabled={disabled} min={1} max={3600} onChange={value => edit(next => { next.providerRouting.cooldownSeconds = value })} />
              </Group>

              <Group title={t('limits')}>
                <NumberField id="vision-max-images" label={t('maxImagesPerCall')} value={draft.limits.maxImagesPerCall} disabled={disabled} min={1} max={4} onChange={value => edit(next => { next.limits.maxImagesPerCall = value })} />
                <NumberField id="vision-max-bytes" label={t('maxImageBytes')} value={draft.limits.maxImageBytes} disabled={disabled} min={1024} onChange={value => edit(next => { next.limits.maxImageBytes = value })} />
                <NumberField id="vision-max-pixels" label={t('maxImagePixels')} value={draft.limits.maxImagePixels} disabled={disabled} min={1} onChange={value => edit(next => { next.limits.maxImagePixels = value })} />
              </Group>

              <Group title={t('cache')}>
                <div className={css.span2}><Toggle label={t('cacheEnabled')} checked={draft.cache.enabled} disabled={disabled} onChange={value => edit(next => { next.cache.enabled = value })} /></div>
                <NumberField id="vision-cache-entries" label={t('maxEntries')} value={draft.cache.maxEntries} disabled={disabled} min={1} max={2000} onChange={value => edit(next => { next.cache.maxEntries = value })} />
                <NumberField id="vision-cache-ttl" label={t('ttlSeconds')} value={draft.cache.ttlSeconds} disabled={disabled} min={0} max={86400} onChange={value => edit(next => { next.cache.ttlSeconds = value })} />
              </Group>

              <Group title={t('processing')}>
                <div className={css.span2}><Toggle label={t('localProcessingEnabled')} checked={draft.localProcessing.enabled} disabled={disabled} onChange={value => edit(next => { next.localProcessing.enabled = value })} /></div>
                <NumberField id="vision-working-pixels" label={t('maxWorkingPixels')} value={draft.localProcessing.maxWorkingPixels} disabled={disabled} min={1} max={40000000} onChange={value => edit(next => { next.localProcessing.maxWorkingPixels = value })} />
              </Group>

              <Group title={t('ocr')}>
                <div className={css.span2}><Toggle label={t('localOcrEnabled')} checked={draft.localOcr.enabled} disabled={disabled} onChange={value => edit(next => { next.localOcr.enabled = value })} /></div>
                <div className={css.span2}><TextField id="vision-ocr-path" label={t('languagePath')} value={draft.localOcr.languagePath} disabled={disabled} placeholder="D:\\vision-data\\tessdata" onChange={value => edit(next => { next.localOcr.languagePath = value })} /></div>
                <TextField id="vision-ocr-languages" label={t('languages')} value={draft.localOcr.languages.join(', ')} disabled={disabled} onChange={value => edit(next => { next.localOcr.languages = value.split(',').map(item => item.trim()).filter(Boolean) })} />
                <label className={css.field} htmlFor="vision-page-seg"><span className={css.label}>{t('pageSegMode')}</span><select id="vision-page-seg" className={css.input} value={draft.localOcr.pageSegMode} disabled={disabled} onChange={event => edit(next => { next.localOcr.pageSegMode = event.target.value as Config['localOcr']['pageSegMode'] })}><option value="auto">auto</option><option value="single-block">single-block</option><option value="sparse-text">sparse-text</option></select></label>
                <NumberField id="vision-ocr-timeout" label={t('ocrTimeoutMs')} value={draft.localOcr.timeoutMs} disabled={disabled} min={1000} max={300000} onChange={value => edit(next => { next.localOcr.timeoutMs = value })} />
                <NumberField id="vision-language-bytes" label={t('maxLanguageBytes')} value={draft.localOcr.maxLanguageBytes} disabled={disabled} min={1024} onChange={value => edit(next => { next.localOcr.maxLanguageBytes = value })} />
                <NumberField id="vision-max-regions" label={t('maxRegions')} value={draft.localOcr.maxRegions} disabled={disabled} min={1} max={200} onChange={value => edit(next => { next.localOcr.maxRegions = value })} />
                <NumberField id="vision-low-confidence" label={t('lowConfidenceThreshold')} value={draft.localOcr.lowConfidenceThreshold} disabled={disabled} min={0} max={100} onChange={value => edit(next => { next.localOcr.lowConfidenceThreshold = value })} />
                <div className={css.toggles}><Toggle label={t('gzip')} checked={draft.localOcr.gzip} disabled={disabled} onChange={value => edit(next => { next.localOcr.gzip = value })} /><Toggle label={t('autoRotate')} checked={draft.localOcr.autoRotate} disabled={disabled} onChange={value => edit(next => { next.localOcr.autoRotate = value })} /></div>
              </Group>

              <Group title={t('browser')}>
                <div className={css.span2}><Toggle label={t('browserEnabled')} checked={draft.browserCapture.enabled} disabled={disabled} onChange={value => edit(next => { next.browserCapture.enabled = value })} /></div>
                <label className={css.field} htmlFor="vision-browser-channel"><span className={css.label}>{t('browserChannel')}</span><select id="vision-browser-channel" className={css.input} value={draft.browserCapture.browserChannel} disabled={disabled} onChange={event => edit(next => { next.browserCapture.browserChannel = event.target.value as Config['browserCapture']['browserChannel'] })}><option value="msedge">Microsoft Edge</option><option value="chrome">Google Chrome</option></select></label>
                <label className={css.field} htmlFor="vision-allowed-hosts"><span className={css.label}>{t('allowedHosts')}</span><textarea id="vision-allowed-hosts" className={css.textarea} value={draft.browserCapture.allowedHosts.join('\n')} disabled={disabled} onChange={event => edit(next => { next.browserCapture.allowedHosts = event.target.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean) })} /></label>
                <NumberField id="vision-viewport-width" label={t('viewportWidth')} value={draft.browserCapture.viewportWidth} disabled={disabled} min={320} max={3840} onChange={value => edit(next => { next.browserCapture.viewportWidth = value })} />
                <NumberField id="vision-viewport-height" label={t('viewportHeight')} value={draft.browserCapture.viewportHeight} disabled={disabled} min={240} max={2160} onChange={value => edit(next => { next.browserCapture.viewportHeight = value })} />
                <NumberField id="vision-page-height" label={t('maxPageHeight')} value={draft.browserCapture.maxPageHeight} disabled={disabled} min={240} max={30000} onChange={value => edit(next => { next.browserCapture.maxPageHeight = value })} />
                <NumberField id="vision-navigation-timeout" label={t('navigationTimeoutMs')} value={draft.browserCapture.navigationTimeoutMs} disabled={disabled} min={1000} max={120000} onChange={value => edit(next => { next.browserCapture.navigationTimeoutMs = value })} />
                <div className={css.span2}><Toggle label={t('allowPrivateHosts')} checked={draft.browserCapture.allowPrivateHosts} disabled={disabled} onChange={value => edit(next => { next.browserCapture.allowPrivateHosts = value })} /></div>
              </Group>

              <Group title={t('network')}>
                <NumberField id="vision-total-timeout" label={t('timeoutMs')} value={draft.timeoutMs} disabled={disabled} min={1000} max={600000} onChange={value => edit(next => { next.timeoutMs = value })} />
                <TextField id="vision-proxy-url" label={t('proxyUrl')} value={draft.proxyUrl} disabled={disabled} placeholder="http://127.0.0.1:7890" onChange={value => edit(next => { next.proxyUrl = value })} />
              </Group>

              <div className={css.footer}>
                <span className={result === 'failed' ? css.error : css.success} role="status">{result === 'saved' ? t('saved') : result === 'failed' ? t('failed') : ''}</span>
                <button type="button" className={css.secondary} disabled={!dirty || saving} onClick={discard}>{t('discard')}</button>
                <button type="button" className={css.primary} disabled={!dirty || saving || !settings.writable} onClick={() => { void save() }}>{t(saving ? 'saving' : 'save')}</button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </li>
  )
}
