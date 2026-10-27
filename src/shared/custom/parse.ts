import { fromUnixSeconds, isIsoDate } from '../protocol/dates.js'
import { isRecord } from '../providers/http.js'
import type { RawRow } from '../providers/series.js'
import type { CsvFields, DateFormat, JsonFields } from './definition.js'

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
    if (!Number.isFinite(n) || n <= 0) return undefined
    return fromUnixSeconds(format === 'unixms' ? Math.floor(n / 1000) : Math.floor(n))
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
    return items.map((item) => row(getPath(item, fields.date ?? 'date'), getPath(item, fields.close)))
  }
  if (!isRecord(items)) return []
  const dates = fields.date ? getPath(items, fields.date) : undefined
  const closes = getPath(items, fields.close)
  if (Array.isArray(dates) && Array.isArray(closes)) {
    return dates.map((d, i) => row(d, closes[i]))
  }
  return Object.entries(items).map(([key, value]) => row(fields.date ? getPath(value, fields.date) : key, getPath(value, fields.close)))
}

/** Split CSV text into rows: quoted fields, doubled quotes, CRLF and a leading BOM handled. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
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
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
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

/** Rows from a CSV answer. Rows whose date or price does not read are skipped (a header row included). */
export function csvRows(text: string, fields: CsvFields, dateFormat: DateFormat, decimal: '.' | ','): RawRow[] {
  const rows = splitCsv(text, fields.delimiter)
  const header = rows[0]
  const di = columnIndex(fields.date, header)
  const ci = columnIndex(fields.close, header)
  if (di === undefined || ci === undefined) return []
  return rows.map((r) => ({ date: parseDate(r[di], dateFormat), close: parseNumber(r[ci], decimal) }))
}
