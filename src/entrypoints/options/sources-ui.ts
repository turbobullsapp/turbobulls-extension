import { browser } from 'wxt/browser'
import { getKey, setKey } from '../../keys'
import { DATE_FORMATS, parseCustomSource, usesSymbol, type CustomSource } from '../../shared/custom/definition.js'
import { customHistory } from '../../shared/custom/history.js'
import { addDays, todayUtc } from '../../shared/protocol/dates.js'
import { ConnectorError } from '../../shared/protocol/errors.js'
import { LIMITS } from '../../shared/protocol/types.js'
import { getCustomSources, hostOf, KEY_NEEDED, keyDecision, newSourceId, reconcileSitePermissions, removeCustomSource, saveCustomSource, sitePattern } from '../../sources'
import { el, field, icon, input, rowMenu, select, setStatus } from './dom'

const DATE_FORMAT_LABELS: Record<(typeof DATE_FORMATS)[number], string> = {
  'YYYY-MM-DD': '2026-10-23',
  'DD/MM/YYYY': '23/10/2026',
  'MM/DD/YYYY': '10/23/2026',
  'DD.MM.YYYY': '23.10.2026',
  YYYYMMDD: '20261023',
  unix: 'Seconds since 1970',
  unixms: 'Milliseconds since 1970',
}

interface Form {
  root: HTMLElement
  read(): Record<string, unknown>
  key: HTMLInputElement
  testSymbol: HTMLInputElement
  fillExample(): void
}

/** A free, keyless public feed to start from: the European Central Bank's daily exchange rates. */
const ECB_EXAMPLE = {
  name: 'Euro in US dollars (ECB)',
  url: 'https://data-api.ecb.europa.eu/service/data/EXR/D.{SYMBOL}.EUR.SP00.A?format=csvdata&startPeriod={FROM}&endPeriod={TO}',
  format: 'csv',
  csvDate: 'TIME_PERIOD',
  csvClose: 'OBS_VALUE',
  currency: 'USD',
  symbolHint: 'USD, the currency of the prices',
  testSymbol: 'USD',
} as const

function stepTitle(text: string): HTMLElement {
  return el('h4', { className: 'form-step' }, text)
}

function buildForm(existing: CustomSource | undefined, hasKey: boolean): Form {
  const name = input({ value: existing?.name ?? '', placeholder: 'My pension fund', maxLength: 40 })
  const url = input({ value: existing?.url ?? '', placeholder: 'https://api.example.com/prices/{SYMBOL}?from={FROM}&to={TO}' })
  const format = select(
    [
      ['json', 'JSON'],
      ['csv', 'CSV'],
    ],
    existing?.format ?? 'json',
  )
  const items = input({ value: existing?.json?.items ?? '', placeholder: 'data.prices' })
  const jsonDate = input({ value: existing?.json?.date ?? '', placeholder: 'date' })
  const jsonClose = input({ value: existing?.json?.close ?? '', placeholder: 'close' })
  const csvDate = input({ value: existing?.csv?.date ?? '', placeholder: 'Date' })
  const csvClose = input({ value: existing?.csv?.close ?? '', placeholder: 'Close' })
  const delimiter = select(
    [
      [',', 'Comma'],
      [';', 'Semicolon'],
      ['\t', 'Tab'],
    ],
    existing?.csv?.delimiter ?? ',',
  )
  const dateFormat = select(
    DATE_FORMATS.map((f) => [f, DATE_FORMAT_LABELS[f]] as const),
    existing?.dateFormat ?? 'YYYY-MM-DD',
  )
  const decimal = select(
    [
      ['.', '1,234.56'],
      [',', '1.234,56'],
    ],
    existing?.decimal ?? '.',
  )
  const currency = input({ value: existing?.currency ?? '', placeholder: 'EUR', maxLength: 3 })
  const symbolHint = input({ value: existing?.symbolHint ?? '', placeholder: 'Fund code', maxLength: LIMITS.symbolLength })
  const [headerName, headerValue] = Object.entries(existing?.headers ?? {})[0] ?? ['', '{KEY}']
  const header = input({ value: headerName, placeholder: 'X-Api-Key' })
  const headerTemplate = input({ value: headerValue, placeholder: '{KEY}' })
  const key = input({ type: 'password', placeholder: hasKey ? 'Saved; leave empty to keep it' : 'Only if the source needs one' })
  const testSymbol = input({ placeholder: 'A symbol to try' })

  const jsonFields = el(
    'div',
    { className: 'group' },
    field('Path to the list', items, 'Dots between names; leave empty when the answer is the list itself.'),
    field('Date field', jsonDate, 'Inside each item. Leave empty when the list is keyed by date.'),
    field('Price field', jsonClose),
  )
  const csvFields = el(
    'div',
    { className: 'group' },
    field('Date column', csvDate, 'Its name in the header row, or its number counting from 1.'),
    field('Price column', csvClose),
    field('Separator', delimiter),
  )
  const showFormat = () => {
    jsonFields.hidden = format.value !== 'json'
    csvFields.hidden = format.value !== 'csv'
  }
  format.addEventListener('change', showFormat)
  showFormat()

  const fillExample = () => {
    name.value = ECB_EXAMPLE.name
    url.value = ECB_EXAMPLE.url
    format.value = ECB_EXAMPLE.format
    csvDate.value = ECB_EXAMPLE.csvDate
    csvClose.value = ECB_EXAMPLE.csvClose
    delimiter.value = ','
    dateFormat.value = 'YYYY-MM-DD'
    decimal.value = '.'
    currency.value = ECB_EXAMPLE.currency
    symbolHint.value = ECB_EXAMPLE.symbolHint
    testSymbol.value = ECB_EXAMPLE.testSymbol
    showFormat()
  }
  const exampleButton = el('button', { type: 'button' }, 'Fill in the ECB example')
  exampleButton.addEventListener('click', fillExample)

  const root = el(
    'div',
    { className: 'source-form' },
    ...(existing
      ? []
      : [el('div', { className: 'examples' }, 'New to this? Start from a free public feed: one euro in US dollars, from the European Central Bank.', exampleButton)]),
    stepTitle('1. Where to ask'),
    field('Name', name, 'What Turbobulls shows for this source.'),
    field('Address', url, 'The https address that answers with prices. Placeholders: {SYMBOL}, {FROM} and {TO} (dates), {FROM_UNIX} and {TO_UNIX}, {KEY}.'),
    field('Symbol label', symbolHint, 'Optional: what Turbobulls asks you to type in place of {SYMBOL}, like "Fund code".'),
    stepTitle('2. What it answers'),
    field('Format', format),
    jsonFields,
    csvFields,
    stepTitle('3. How it writes dates and prices'),
    field('Date format', dateFormat),
    field('Decimal separator', decimal),
    field('Currency', currency, 'The currency its prices are in: three letters, or GBp for pence.'),
    stepTitle('4. A key, only if it needs one'),
    field('Key header', header, 'The header that carries the key, if the source wants one.'),
    field('Header value', headerTemplate, 'Where the key goes, like {KEY} or Bearer {KEY}.'),
    field('Key', key, 'Kept in this browser only.'),
    stepTitle('5. Check it'),
    field('Try with symbol', testSymbol, 'Fetches the last 30 days, so you can check the prices before you save.'),
  )

  const read = (): Record<string, unknown> => {
    const headers: Record<string, string> = {}
    if (header.value.trim()) headers[header.value.trim()] = headerTemplate.value.trim() || '{KEY}'
    return {
      name: name.value,
      url: url.value,
      format: format.value,
      json: { items: items.value, date: jsonDate.value, close: jsonClose.value },
      csv: { date: csvDate.value, close: csvClose.value, delimiter: delimiter.value },
      dateFormat: dateFormat.value,
      decimal: decimal.value,
      currency: currency.value,
      headers,
      symbolHint: symbolHint.value,
    }
  }
  return { root, read, key, testSymbol, fillExample }
}

/** Ask Chrome for the site; this must be the first wait in a click, or Chrome refuses it. */
async function askForSite(source: CustomSource): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [sitePattern(source)] })
  } catch {
    return false
  }
}

export async function renderSources(container: HTMLElement, onChange: () => void): Promise<void> {
  const sources = await getCustomSources()
  const list = el('div', { className: 'list' })
  for (const source of sources) {
    const edit = el('button', { type: 'button', className: 'sm' }, 'Edit')
    edit.addEventListener('click', () => void openForm(container, onChange, source))
    const remove = async () => {
      if (!confirm(`Remove ${source.name}? Assets linked to it keep the prices they have, and stop updating.`)) return
      await removeCustomSource(source.id)
      await renderSources(container, onChange)
      onChange()
    }
    list.append(
      el(
        'div',
        { className: 'item' },
        el(
          'div',
          { className: 'row' },
          el(
            'div',
            {},
            el('div', { className: 'name' }, source.name),
            el('div', { className: 'sub' }, `${source.format.toUpperCase()}, prices in ${source.currency}, from ${hostOf(source)}`),
          ),
          el('span', { className: 'badge ok' }, 'Ready'),
          el('div', { className: 'actions' }, edit, rowMenu(`More for ${source.name}`, [{ label: 'Remove', danger: true, onSelect: () => void remove() }])),
        ),
      ),
    )
  }
  const add = el('button', { type: 'button', className: 'add' }, icon('plus'), 'Add a source')
  add.disabled = sources.length >= LIMITS.customSources
  add.addEventListener('click', () => void openForm(container, onChange, undefined))
  const children: HTMLElement[] = []
  if (sources.length === 0) {
    const example = el('button', { type: 'button', className: 'link' }, 'Start from the European Central Bank\u2019s free euro rates')
    example.addEventListener('click', () => void openForm(container, onChange, undefined, { example: true }))
    children.push(el('p', { className: 'empty' }, 'A pension fund\u2019s daily price, a small exchange, a sheet you publish yourself. New to this? ', example, '.'))
  } else {
    children.push(list)
  }
  children.push(add)
  container.replaceChildren(...children)
}

async function openForm(
  container: HTMLElement,
  onChange: () => void,
  existing: CustomSource | undefined,
  options: { example?: boolean } = {},
): Promise<void> {
  const taken = (await getCustomSources()).map((s) => s.id).filter((id) => id !== existing?.id)
  const hasKey = existing ? Boolean(await getKey(existing.id)) : false
  const form = buildForm(existing, hasKey)
  if (options.example) form.fillExample()
  const status = el('p', { className: 'status', role: 'status' })
  status.setAttribute('aria-live', 'polite')
  const errors = el('ul', { className: 'errors' })
  const tryIt = el('button', { type: 'button' }, 'Try it')
  const save = el('button', { type: 'button', className: 'primary' }, 'Save')
  const cancel = el('button', { type: 'button' }, 'Cancel')

  const parse = (): CustomSource | undefined => {
    const raw = form.read()
    const result = parseCustomSource({ ...raw, id: existing?.id ?? newSourceId(String(raw.name ?? ''), taken) })
    errors.replaceChildren(...(result.ok ? [] : result.errors.map((e) => el('li', {}, e))))
    if (!result.ok) setStatus(status, 'Fix the settings above first.', 'error')
    return result.ok ? result.source : undefined
  }

  tryIt.addEventListener('click', async () => {
    const source = parse()
    if (!source) return
    if (!(await askForSite(source))) {
      setStatus(status, `Chrome did not allow reaching ${hostOf(source)}.`, 'error')
      return
    }
    const symbol = form.testSymbol.value.trim() || (usesSymbol(source) ? '' : 'TEST')
    if (!symbol) {
      setStatus(status, 'Type a symbol to try, since the address uses {SYMBOL}.', 'error')
      return
    }
    const decision = keyDecision(existing, source, form.key.value)
    if (decision === 'retype' || decision === 'missing') {
      setStatus(status, KEY_NEEDED[decision], 'error')
      return
    }
    setStatus(status, 'Asking the source for the last 30 days...')
    const key = decision === 'typed' ? form.key.value.trim() : decision === 'saved' && existing ? await getKey(existing.id) : undefined
    const today = todayUtc()
    try {
      const answer = await customHistory(source, symbol, addDays(today, -30), today, {
        fetch: (url, init) => fetch(url, init),
        ...(key ? { key } : {}),
      })
      const last = answer.prices[answer.prices.length - 1]
      setStatus(
        status,
        last
          ? `Found ${answer.prices.length} prices, the latest ${last.close} ${answer.currency} on ${last.date}.`
          : 'The source answered, with no prices in the last 30 days.',
        last ? 'ok' : 'info',
      )
    } catch (e) {
      setStatus(status, e instanceof ConnectorError ? e.message : 'The source could not be read.', 'error')
    }
  })

  save.addEventListener('click', async () => {
    const source = parse()
    if (!source) return
    const decision = keyDecision(existing, source, form.key.value)
    if (decision === 'retype' || decision === 'missing') {
      setStatus(status, KEY_NEEDED[decision], 'error')
      return
    }
    if (!(await askForSite(source))) {
      setStatus(status, `Chrome did not allow reaching ${hostOf(source)}, so the source was not saved.`, 'error')
      return
    }
    try {
      await saveCustomSource(source)
      if (decision === 'typed') await setKey(source.id, form.key.value)
      else if (decision === 'none') await setKey(source.id, '')
      await reconcileSitePermissions()
    } catch (e) {
      setStatus(status, e instanceof Error ? e.message : 'The source could not be saved.', 'error')
      return
    }
    await renderSources(container, onChange)
    onChange()
  })
  cancel.addEventListener('click', async () => {
    await reconcileSitePermissions()
    await renderSources(container, onChange)
  })

  container.replaceChildren(
    el(
      'div',
      { className: 'card-body' },
      el('h3', { className: 'form-title' }, existing ? `Edit ${existing.name}` : 'Add a source'),
      form.root,
      errors,
      el('div', { className: 'controls' }, save, tryIt, cancel),
      status,
    ),
  )
}
