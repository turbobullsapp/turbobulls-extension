import { fromUnixSeconds, isIsoDate } from '../protocol/dates.js'
import { isRecord } from '../providers/http.js'
import type { RawRow } from '../providers/series.js'
import type { CsvFields, DateFormat, JsonFields } from './definition.js'

/** Most rows (or list items) read from one answer: decades of daily prices fit many times over. */
export const MAX_ROWS = 100_000
/** Most columns one CSV row may have. */
export const MAX_COLUMNS = 1_000
/** Year 3000 in seconds: anything later is not a price date, and would not convert. */
const MAX_UNIX_SECONDS = 32_503_680_000

/** Thrown when an answer has more rows or columns than the limits allow. */
export class TooLarge extends Error {
  constructor(readonly what: 'rows' | 'columns') {
    super(what)
  }
}

/** Read a dot path (`data.prices`, `chart.result.0.close`) without ever touching inherited keys. */
export function getPath(node: unknown, path: string): unknown {
  if (path === '') return node
  let current = node
  for (const segment of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)]
    else if (isRecord(current) && Object.hasOwn(current, segment)) current = current[segment]
    else return undefined
  }
  return current
}

function pad(n: string): string {
  return n.padStart(2, '0')
}

/** A date in the source's format, as YYYY-MM-DD, or undefined when it is not one. */
export function parseDate(value: unknown, format: DateFormat): string | undefined {
  if (format === 'unix' || format === 'unixms') {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN
    const seconds = format === 'unixms' ? Math.floor(n / 1000) : Math.floor(n)
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_UNIX_SECONDS) return undefined
    return fromUnixSeconds(seconds)
  }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const s = String(value).trim()
  let iso: string | undefined
  let m: RegExpExecArray | null
  switch (format) {
    case 'YYYY-MM-DD':
      iso = s.slice(0, 10)
      break
    case 'YYYYMMDD':
      iso = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : undefined
      break
    case 'DD/MM/YYYY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
      iso = m ? `${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}` : undefined
      break
    case 'MM/DD/YYYY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
      iso = m ? `${m[3]}-${pad(m[1]!)}-${pad(m[2]!)}` : undefined
      break
    case 'DD.MM.YYYY':
      m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s)
      iso = m ? `${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}` : undefined
      break
  }
  return isIsoDate(iso) ? iso : undefined
}

/** A price as written by the source: 1234.56, "1,234.56", "1.234,56" (decimal comma), "1 234,56". */
export function parseNumber(value: unknown, decimal: '.' | ','): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  let s = value.trim().replace(/[\s\u00a0\u202f']/g, '')
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  if (!/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Rows from a JSON answer. The list can be an array of items, an object keyed by date, or an object
 * holding two parallel arrays (dates and prices, as some chart APIs send them).
 */
export function jsonRows(body: unknown, fields: JsonFields, dateFormat: DateFormat, decimal: '.' | ','): RawRow[] {
  const items = getPath(body, fields.items)
  const row = (date: unknown, close: unknown): RawRow => ({ date: parseDate(date, dateFormat), close: parseNumber(close, decimal) })
  if (Array.isArray(items)) {
    if (items.length > MAX_ROWS) throw new TooLarge('rows')
    return items.map((item) => row(getPath(item, fields.date ?? 'date'), getPath(item, fields.close)))
  }
  if (!isRecord(items)) return []
  const dates = fields.date ? getPath(items, fields.date) : undefined
  const closes = getPath(items, fields.close)
  if (Array.isArray(dates) && Array.isArray(closes)) {
    if (dates.length > MAX_ROWS) throw new TooLarge('rows')
    return dates.map((d, i) => row(d, closes[i]))
  }
  const keys = Object.keys(items)
  if (keys.length > MAX_ROWS) throw new TooLarge('rows')
  return keys.map((key) => row(fields.date ? getPath(items[key], fields.date) : key, getPath(items[key], fields.close)))
}

/**
 * Walk CSV text one row at a time: quoted fields, doubled quotes, CRLF and a leading BOM handled,
 * blank lines skipped. Only the current row is held, so a huge answer never becomes a huge array.
 */
export function eachCsvRow(text: string, delimiter: string, onRow: (fields: string[]) => void): void {
  let row: string[] = []
  let field = ''
  let quoted = false
  let rows = 0
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const pushField = () => {
    if (row.length >= MAX_COLUMNS) throw new TooLarge('columns')
    row.push(field)
    field = ''
  }
  const endRow = () => {
    pushField()
    const blank = row.length === 1 && row[0] === ''
    if (!blank) {
      if (++rows > MAX_ROWS) throw new TooLarge('rows')
      onRow(row)
    }
    row = []
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) pushField()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      endRow()
    } else field += ch
  }
  if (field !== '' || row.length > 0) endRow()
}

/** All rows of a CSV text (small texts and tests; parsing uses eachCsvRow). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  eachCsvRow(text, delimiter, (r) => rows.push(r))
  return rows
}

function columnIndex(ref: string, header: string[] | undefined): number | undefined {
  if (/^\d+$/.test(ref)) {
    const n = Number(ref)
    return n >= 1 ? n - 1 : undefined
  }
  const wanted = ref.trim().toLowerCase()
  const index = header?.findIndex((h) => h.trim().toLowerCase() === wanted) ?? -1
  return index >= 0 ? index : undefined
}

/**
 * Rows from a CSV answer, keeping only the two configured columns. Rows whose date or price does
 * not read are skipped (a header row included).
 */
export function csvRows(text: string, fields: CsvFields, dateFormat: DateFormat, decimal: '.' | ','): RawRow[] {
  const out: RawRow[] = []
  let di: number | undefined
  let ci: number | undefined
  let first = true
  eachCsvRow(text, fields.delimiter, (r) => {
    if (first) {
      first = false
      di = columnIndex(fields.date, r)
      ci = columnIndex(fields.close, r)
    }
    if (di === undefined || ci === undefined) return
    out.push({ date: parseDate(r[di], dateFormat), close: parseNumber(r[ci], decimal) })
  })
  return out
}
