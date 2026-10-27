import { CUSTOM_ID_RE, LIMITS, PROVIDER_IDS } from '../protocol/types.js'
import { toMajor } from '../providers/currency.js'
import { cleanText } from '../sanitize.js'

/**
 * A data source the user defines in the connector: a web address with placeholders, the format of
 * the answer, where the date and the price sit in it, and the currency. The app can only name a
 * source by its id; it can never add one, change one or send an address.
 */
export interface CustomSource {
  id: string
  name: string
  /** https address with placeholders: {SYMBOL}, {FROM}, {TO}, {FROM_UNIX}, {TO_UNIX}, {KEY}. */
  url: string
  format: 'json' | 'csv'
  json?: JsonFields
  csv?: CsvFields
  dateFormat: DateFormat
  decimal: '.' | ','
  /** As the user wrote it; may be a minor unit (GBp), converted when prices are read. */
  currency: string
  /** Extra request headers; a value may hold {KEY}. */
  headers: Record<string, string>
  symbolHint?: string
}

export interface JsonFields {
  /** Dot path to the list (or object of dates) inside the answer; empty for the answer itself. */
  items: string
  /** Dot path to the date inside each item; left out when the list is an object keyed by date. */
  date?: string
  /** Dot path to the price inside each item. */
  close: string
}

export interface CsvFields {
  /** Column name in the header row, or a 1-based column number. */
  date: string
  close: string
  delimiter: ',' | ';' | '\t'
}

export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'YYYYMMDD', 'unix', 'unixms'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const PLACEHOLDERS = ['SYMBOL', 'FROM', 'TO', 'FROM_UNIX', 'TO_UNIX', 'KEY'] as const

const URL_MAX = 500
const PATH_MAX = 120
const HEADER_MAX = 5
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/
// Headers a source may not set: they belong to the browser, would change where or how a request
// goes, or are ones a browser drops (so the extension and the bridge would differ).
const FORBIDDEN_HEADERS =
  /^(host|cookie|cookie2|set-cookie|origin|referer|content-length|content-type|connection|keep-alive|transfer-encoding|upgrade|te|trailer|expect|date|dnt|via|accept-charset|accept-encoding|access-control-.*|forwarded|x-forwarded-.*|x-original-url|x-rewrite-url|x-http-method|x-http-method-override|x-method-override|proxy-.*|sec-.*)$/i
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const PLACEHOLDER_RE = /\{([^{}]*)\}/g
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/

export type ParseResult = { ok: true; source: CustomSource } | { ok: false; errors: string[] }

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

/** The host part of an https address template: between `https://` and the first `/`, `?` or `#`. */
export function templateHost(url: string): string | undefined {
  if (!url.toLowerCase().startsWith('https://')) return undefined
  const rest = url.slice('https://'.length)
  const end = rest.search(/[/?#]/)
  return end === -1 ? rest : rest.slice(0, end)
}

/** Whether the template sends the symbol, or a key (in the address or a header). */
export function usesSymbol(source: Pick<CustomSource, 'url'>): boolean {
  return source.url.includes('{SYMBOL}')
}

export function usesKey(source: Pick<CustomSource, 'url' | 'headers'>): boolean {
  return source.url.includes('{KEY}') || Object.values(source.headers).some((v) => v.includes('{KEY}'))
}

function checkPath(label: string, path: string | undefined, errors: string[], required: boolean): string | undefined {
  if (path === undefined || path === '') {
    if (required) errors.push(`${label} is required.`)
    return path === '' ? '' : undefined
  }
  if (path.length > PATH_MAX || CONTROL_RE.test(path)) {
    errors.push(`${label} must be a plain dot path up to ${PATH_MAX} characters.`)
    return undefined
  }
  const segments = path.split('.')
  if (segments.some((s) => s === '' || UNSAFE_PATH_SEGMENTS.has(s))) {
    errors.push(`${label} must be names separated by dots, like data.prices.`)
    return undefined
  }
  return path
}

function checkTemplate(url: string, errors: string[], placeholdersAllowed: readonly string[], label: string): void {
  // A percent sign before a placeholder would let the filled-in value finish an escape like %2e.
  if (url.includes('%{')) {
    errors.push(`${label} has a % right before a placeholder.`)
    return
  }
  for (const match of url.matchAll(PLACEHOLDER_RE)) {
    if (!placeholdersAllowed.includes(match[1] ?? '')) {
      errors.push(`${label} uses an unknown placeholder. Use ${placeholdersAllowed.map((p) => `{${p}}`).join(', ')}.`)
      return
    }
  }
  const withoutPlaceholders = url.replace(PLACEHOLDER_RE, '')
  if (withoutPlaceholders.includes('{') || withoutPlaceholders.includes('}')) {
    errors.push(`${label} has a brace that is not part of a placeholder.`)
  }
}

/**
 * Check a source the user typed (extension settings) or wrote (bridge config file). Errors name the
 * field, never repeat its value: a key pasted in the wrong field must not land in a message.
 */
export function parseCustomSource(input: unknown): ParseResult {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['A source is an object of settings.'] }
  }
  const raw = input as Record<string, unknown>

  const id = str(raw.id)
  if (!id || !CUSTOM_ID_RE.test(id)) errors.push('The id must be 2 to 32 lower-case letters and digits, starting with a letter.')
  else if ((PROVIDER_IDS as readonly string[]).includes(id)) errors.push('The id is taken by a built-in provider.')

  const name = cleanText(str(raw.name), 40)
  if (!name) errors.push('The name is required (up to 40 characters).')

  const url = str(raw.url) ?? ''
  const host = templateHost(url)
  if (!url) errors.push('The address is required.')
  else if (url.length > URL_MAX || CONTROL_RE.test(url) || /\s/.test(url)) errors.push(`The address must be one line up to ${URL_MAX} characters.`)
  else if (!host) errors.push('The address must start with https://.')
  else if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) errors.push('The address must name a plain host after https://, with no placeholder or @ in it.')
  else {
    checkTemplate(url, errors, PLACEHOLDERS, 'The address')
    try {
      new URL(url.replace(PLACEHOLDER_RE, 'x'))
    } catch {
      errors.push('The address is not a valid web address.')
    }
  }

  const format = raw.format === 'csv' ? 'csv' : raw.format === 'json' || raw.format === undefined ? 'json' : undefined
  if (!format) errors.push('The format must be json or csv.')

  let json: JsonFields | undefined
  let csv: CsvFields | undefined
  if (format === 'json') {
    const j = (typeof raw.json === 'object' && raw.json !== null ? raw.json : {}) as Record<string, unknown>
    const items = checkPath('The path to the list', str(j.items) ?? '', errors, false) ?? ''
    const date = checkPath('The date field', str(j.date), errors, false)
    const close = checkPath('The price field', str(j.close), errors, true)
    if (close !== undefined) json = date === undefined || date === '' ? { items, close } : { items, date, close }
  } else if (format === 'csv') {
    const c = (typeof raw.csv === 'object' && raw.csv !== null ? raw.csv : {}) as Record<string, unknown>
    const column = (label: string, value: unknown) => {
      const v = typeof value === 'number' ? String(value) : str(value)
      if (!v || v.length > 64 || CONTROL_RE.test(v)) {
        errors.push(`${label} is required: a column name from the header row, or a column number.`)
        return undefined
      }
      return v
    }
    const date = column('The date column', c.date)
    const close = column('The price column', c.close)
    const delimiter = c.delimiter === ';' || c.delimiter === '\t' ? c.delimiter : c.delimiter === ',' || c.delimiter === undefined ? ',' : undefined
    if (!delimiter) errors.push('The separator must be a comma, a semicolon or a tab.')
    if (date && close && delimiter) csv = { date, close, delimiter }
  }

  const dateFormat = raw.dateFormat === undefined ? 'YYYY-MM-DD' : raw.dateFormat
  if (!(DATE_FORMATS as readonly unknown[]).includes(dateFormat)) errors.push(`The date format must be one of ${DATE_FORMATS.join(', ')}.`)

  const decimal = raw.decimal === undefined || raw.decimal === '.' ? '.' : raw.decimal === ',' ? ',' : undefined
  if (!decimal) errors.push('The decimal separator must be . or ,')

  const currency = str(raw.currency) ?? ''
  if (!toMajor(currency)) errors.push('The currency must be a three-letter code like EUR, or GBp for pence.')

  const headers: Record<string, string> = {}
  if (raw.headers !== undefined) {
    if (typeof raw.headers !== 'object' || raw.headers === null || Array.isArray(raw.headers)) {
      errors.push('The headers must be names and values.')
    } else {
      const entries = Object.entries(raw.headers as Record<string, unknown>)
      if (entries.length > HEADER_MAX) errors.push(`At most ${HEADER_MAX} headers.`)
      // Headers are named by position, never by name: a key pasted as a name must not be repeated.
      entries.slice(0, HEADER_MAX).forEach(([headerName, value], index) => {
        const label = `Header ${index + 1}`
        if (!HEADER_NAME_RE.test(headerName) || FORBIDDEN_HEADERS.test(headerName)) {
          errors.push(`${label} has a name that is not allowed: use letters, digits and dashes, and not Host, Cookie, Origin or similar.`)
          return
        }
        if (typeof value !== 'string' || value.length > URL_MAX || CONTROL_RE.test(value)) {
          errors.push(`${label} must have a value of one line up to ${URL_MAX} characters.`)
          return
        }
        checkTemplate(value, errors, ['KEY'], label)
        headers[headerName] = value
      })
    }
  }

  const symbolHint = cleanText(str(raw.symbolHint), LIMITS.symbolLength)

  if (errors.length > 0 || !id || !name || !format || !decimal) return { ok: false, errors }
  const source: CustomSource = {
    id,
    name,
    url,
    format,
    dateFormat: dateFormat as DateFormat,
    decimal,
    currency,
    headers,
  }
  if (json) source.json = json
  if (csv) source.csv = csv
  if (symbolHint) source.symbolHint = symbolHint
  return { ok: true, source }
}
