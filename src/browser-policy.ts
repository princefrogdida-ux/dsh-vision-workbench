import { isIP } from 'node:net'

export interface BrowserNetworkPolicy {
  allowedHosts: readonly string[]
  allowPrivateHosts: boolean
}

export type HostResolver = (hostname: string) => Promise<readonly string[]>

function ipv4Parts(address: string): number[] | undefined {
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : undefined
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0] as string
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7))
  if (isIP(normalized) === 4) {
    const parts = ipv4Parts(normalized) as number[]
    const [a, b] = parts
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && (b as number) >= 64 && (b as number) <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && (b as number) >= 16 && (b as number) <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && ((b as number) === 18 || (b as number) === 19))
      || (a as number) >= 224
  }
  if (isIP(normalized) === 6) {
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
  }
  return false
}

export function parseBrowserUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('vision_browser_capture url must be an absolute http:// or https:// URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('vision_browser_capture permits only http:// and https:// URLs')
  }
  if (url.username || url.password) {
    throw new Error('vision_browser_capture does not permit credentials embedded in URLs')
  }
  return url
}

export class BrowserRequestPolicy {
  private readonly allowedHosts: ReadonlySet<string>
  private readonly resolved = new Map<string, Promise<readonly string[]>>()

  constructor(
    private readonly policy: BrowserNetworkPolicy,
    private readonly resolveHost: HostResolver,
  ) {
    this.allowedHosts = new Set(policy.allowedHosts.map(host => host.trim().toLowerCase()))
  }

  async assertAllowed(raw: string): Promise<URL> {
    const url = parseBrowserUrl(raw)
    const hostname = url.hostname.toLowerCase()
    if (!this.allowedHosts.has(hostname)) {
      throw new Error(`vision_browser_capture blocked host "${hostname}"; add the exact hostname to browserCapture.allowedHosts`)
    }
    if (!this.policy.allowPrivateHosts) {
      if (hostname === 'localhost' || isPrivateAddress(hostname)) {
        throw new Error(`vision_browser_capture blocked private host "${hostname}"; enable allowPrivateHosts only for trusted local development`)
      }
      let pending = this.resolved.get(hostname)
      if (pending === undefined) {
        pending = this.resolveHost(hostname)
        this.resolved.set(hostname, pending)
      }
      const addresses = await pending
      if (addresses.length === 0) {
        throw new Error(`vision_browser_capture could not resolve allowed host "${hostname}"`)
      }
      const privateAddress = addresses.find(isPrivateAddress)
      if (privateAddress !== undefined) {
        throw new Error(`vision_browser_capture blocked "${hostname}" because it resolved to private address ${privateAddress}`)
      }
    }
    return url
  }
}
