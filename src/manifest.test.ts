import { describe, expect, it } from 'vitest'
import { DEV_EXTENSION_ID, DEV_PUBLIC_KEY } from './dev-key'
import { buildManifest, PROVIDER_HOSTS } from './manifest'

describe('manifest', () => {
  it('asks for storage and the four provider APIs, nothing more', () => {
    const m = buildManifest('production')
    expect(m.permissions).toEqual(['storage'])
    expect(m.host_permissions).toEqual([...PROVIDER_HOSTS])
    expect(m).not.toHaveProperty('content_scripts')
    expect(m).not.toHaveProperty('optional_host_permissions')
  })

  it('lets only the Turbobulls app message it, and carries no dev key in a store build', () => {
    const m = buildManifest('production')
    expect(m.externally_connectable).toEqual({ matches: ['https://app.turbobulls.com/*'] })
    expect(m).not.toHaveProperty('key')
    expect(m.name).toBe('Turbobulls Connector')
  })

  it('adds the local dev server and the pinned id in a development build', () => {
    const m = buildManifest('development')
    expect(m.externally_connectable.matches).toEqual(['https://app.turbobulls.com/*', 'http://localhost/*'])
    expect(m).toHaveProperty('key', DEV_PUBLIC_KEY)
  })

  it('pins the documented dev id', async () => {
    // Chrome's rule: the first 16 bytes of the key's SHA-256, each hex digit mapped to a-p.
    const der = Uint8Array.from(atob(DEV_PUBLIC_KEY), (c) => c.charCodeAt(0))
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der))
    const hex = [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')).toBe(DEV_EXTENSION_ID)
  })
})
