import { browser } from 'wxt/browser'
import { getKey, keyHints, setKey } from '../../keys'
import { linkAssetUrl } from '../../origins'
import { dispatch } from '../../shared/dispatch.js'
import { PROVIDER_IDS, type ProviderId } from '../../shared/protocol/types.js'
import { ADAPTERS } from '../../shared/providers/registry.js'
import { getCustomSources } from '../../sources'
import { el, setStatus } from './dom'
import { renderSources } from './sources-ui'

/** Where each provider hands out keys. */
const KEY_PAGES: Record<ProviderId, string> = {
  eodhd: 'https://eodhd.com/cp/settings',
  twelvedata: 'https://twelvedata.com/account/api-keys',
  alphavantage: 'https://www.alphavantage.co/support/#api-key',
  finnhub: 'https://finnhub.io/dashboard',
}

async function testKey(provider: ProviderId): Promise<{ ok: boolean; text: string }> {
  const answer = await dispatch(
    { v: 1, id: 'options-test', op: 'search', params: { provider, query: 'Apple' } },
    { connector: 'extension', version: browser.runtime.getManifest().version, getKey, fetch: (url, init) => fetch(url, init) },
  )
  return answer.ok ? { ok: true, text: `${ADAPTERS[provider].name} accepted the key.` } : { ok: false, text: answer.error.message }
}

/** Show the next step once anything is set up: the user's way into the app. */
async function refreshNextStep(): Promise<void> {
  const next = document.getElementById('next')
  const link = document.getElementById('next-link')
  if (!next || !(link instanceof HTMLAnchorElement)) return
  link.href = linkAssetUrl(import.meta.env.MODE)
  const hints = await keyHints()
  const sources = await getCustomSources()
  next.hidden = Object.keys(hints).length === 0 && sources.length === 0
}

function renderProvider(provider: ProviderId, hint: string | undefined): HTMLElement {
  const name = ADAPTERS[provider].name
  const inputId = `key-${provider}`
  const state = el('p', { className: 'state' })
  const status = el('p', { className: 'status', role: 'status' })
  status.setAttribute('aria-live', 'polite')
  const input = el('input', { id: inputId, type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'Paste your API key' })
  const label = el('label', { htmlFor: inputId, className: 'visually-hidden' }, `${name} API key`)
  const show = el('button', { type: 'button' }, 'Show')
  const save = el('button', { type: 'button', className: 'primary' }, 'Save')
  const test = el('button', { type: 'button' }, 'Test key')
  const remove = el('button', { type: 'button' }, 'Remove')

  const refresh = (currentHint: string | undefined) => {
    state.textContent = currentHint ? `A key is saved (ends in ${currentHint}).` : 'No key saved.'
    test.disabled = !currentHint
    remove.disabled = !currentHint
  }
  refresh(hint)

  show.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password'
    show.textContent = input.type === 'password' ? 'Show' : 'Hide'
  })
  save.addEventListener('click', async () => {
    if (!input.value.trim()) {
      setStatus(status, 'Paste a key first.', 'error')
      return
    }
    await setKey(provider, input.value)
    input.value = ''
    input.type = 'password'
    show.textContent = 'Show'
    refresh((await keyHints())[provider])
    setStatus(status, 'Saved. Checking it with one small request...')
    const result = await testKey(provider)
    setStatus(status, result.text, result.ok ? 'ok' : 'error')
    await refreshNextStep()
  })
  test.addEventListener('click', async () => {
    test.disabled = true
    setStatus(status, 'Checking with one small request...')
    const result = await testKey(provider)
    setStatus(status, result.text, result.ok ? 'ok' : 'error')
    test.disabled = false
  })
  remove.addEventListener('click', async () => {
    await setKey(provider, '')
    refresh(undefined)
    setStatus(status, 'Key removed from this browser.')
    await refreshNextStep()
  })

  return el(
    'div',
    { className: 'provider' },
    el(
      'div',
      { className: 'provider-head' },
      el('h3', {}, name),
      el('a', { href: KEY_PAGES[provider], target: '_blank', rel: 'noopener noreferrer' }, 'Get your key'),
    ),
    state,
    el('div', { className: 'row' }, label, input, show, save, test, remove),
    status,
  )
}

async function main() {
  const container = document.getElementById('providers')
  const sources = document.getElementById('sources')
  if (!container || !sources) return
  const hints = await keyHints()
  container.replaceChildren(...PROVIDER_IDS.map((p) => renderProvider(p, hints[p])))
  await renderSources(sources, () => void refreshNextStep())
  await refreshNextStep()
  const version = document.getElementById('version')
  if (version) version.textContent = `Version ${browser.runtime.getManifest().version}`
}

void main()
