import '@fontsource-variable/geist'
import '@fontsource-variable/bricolage-grotesque/wdth.css'
import { browser } from 'wxt/browser'
import { getKey, keyHints, setKey } from '../../keys'
import { dispatch } from '../../shared/dispatch.js'
import { PROVIDER_IDS, type ProviderId } from '../../shared/protocol/types.js'
import { ADAPTERS } from '../../shared/providers/registry.js'
import { reconcileSitePermissions } from '../../sources'
import { el, rowMenu, setStatus } from './dom'
import { renderSources } from './sources-ui'
import { renderSteps, watchSteps } from './steps'

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

/** What each provider covers, in a line under its name. */
const COVERS: Record<ProviderId, string> = {
  eodhd: 'Stocks, ETFs and funds on most exchanges',
  twelvedata: 'Stocks, ETFs, forex and crypto',
  alphavantage: 'Stocks and ETFs. The free plan allows few requests a day',
  finnhub: 'Stocks. Daily prices need a paid plan',
}

/** The key field open in a row, if any: one at a time, so one main button shows. */
let closeOpenEditor: (() => void) | undefined

function renderProvider(provider: ProviderId, hint: string | undefined): HTMLElement {
  const name = ADAPTERS[provider].name
  const inputId = `key-${provider}`
  const badge = el('span', { className: 'badge' })
  const status = el('p', { className: 'status', role: 'status' })
  status.setAttribute('aria-live', 'polite')
  const actions = el('div', { className: 'actions' })

  // The key field, in a row of its own under the provider, while a key is being added or replaced.
  const input = el('input', { id: inputId, type: 'password', autocomplete: 'off', spellcheck: false })
  const label = el('label', { htmlFor: inputId, className: 'visually-hidden' }, `${name} API key`)
  const show = el('button', { type: 'button' }, 'Show')
  const save = el('button', { type: 'button', className: 'primary' }, 'Save and test')
  const cancel = el('button', { type: 'button' }, 'Cancel')
  const editor = el(
    'div',
    { className: 'editor', hidden: true },
    el('div', { className: 'controls' }, label, input, show, save, cancel),
    el('p', { className: 'hint' }, `Find it in your ${name} account. `, el('a', { href: KEY_PAGES[provider], target: '_blank', rel: 'noopener noreferrer' }, 'Get your key')),
  )

  const test = el('button', { type: 'button', className: 'sm' }, 'Test')
  const add = el('button', { type: 'button', className: 'sm' }, 'Add key')
  let current = hint

  const closeEditor = (refocus: boolean) => {
    if (editor.hidden) return
    editor.hidden = true
    input.value = ''
    input.type = 'password'
    show.textContent = 'Show'
    if (closeOpenEditor === close) closeOpenEditor = undefined
    refresh()
    if (refocus) (current ? test : add).focus()
  }
  const close = () => closeEditor(false)
  const openEditor = () => {
    if (closeOpenEditor && closeOpenEditor !== close) closeOpenEditor()
    closeOpenEditor = close
    input.placeholder = current ? `Paste the new ${name} key` : `Paste your ${name} API key`
    editor.hidden = false
    refresh()
    input.focus()
  }

  const removeKey = async () => {
    await setKey(provider, '')
    current = undefined
    refresh()
    setStatus(status, 'Key removed from this browser.')
  }
  const menu = rowMenu(`More for ${name}`, [
    { label: 'Replace the key', onSelect: openEditor },
    { label: `Get a key at ${name}`, href: KEY_PAGES[provider] },
    { label: 'Remove the key', danger: true, onSelect: () => void removeKey() },
  ])

  function refresh() {
    badge.className = current ? 'badge ok' : 'badge quiet'
    badge.replaceChildren(...(current ? ['Key saved, ends in ', el('span', { className: 'mono' }, current)] : ['No key']))
    // The row whose key field is open loses its own Add key: the field's Cancel closes it.
    actions.replaceChildren(...(current ? [test, menu] : editor.hidden ? [add] : []))
  }
  refresh()

  add.addEventListener('click', openEditor)
  cancel.addEventListener('click', () => closeEditor(true))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save.click()
    if (event.key === 'Escape') closeEditor(true)
  })
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
    current = (await keyHints())[provider]
    closeEditor(true)
    setStatus(status, 'Saved. Checking it with one small request...')
    const result = await testKey(provider)
    setStatus(status, result.text, result.ok ? 'ok' : 'error')
  })
  test.addEventListener('click', async () => {
    test.disabled = true
    setStatus(status, 'Checking with one small request...')
    const result = await testKey(provider)
    setStatus(status, result.text, result.ok ? 'ok' : 'error')
    test.disabled = false
  })

  return el(
    'div',
    { className: 'item' },
    el('div', { className: 'row' }, el('div', {}, el('div', { className: 'name' }, name), el('div', { className: 'sub' }, COVERS[provider])), badge, actions),
    editor,
    status,
  )
}

async function main() {
  const container = document.getElementById('providers')
  const sources = document.getElementById('sources')
  if (!container || !sources) return
  // Give back any site left granted by a Try that was never saved (the page may have been closed).
  await reconcileSitePermissions().catch(() => undefined)
  const hints = await keyHints()
  container.replaceChildren(...PROVIDER_IDS.map((p) => renderProvider(p, hints[p])))
  await renderSources(sources, () => undefined)
  const setup = document.getElementById('setup')
  const pill = document.getElementById('setup-pill')
  if (setup && pill) {
    await renderSteps(setup, pill)
    watchSteps(setup, pill)
  }
  const version = document.getElementById('version')
  if (version) version.textContent = `Version ${browser.runtime.getManifest().version}`
}

void main()
