// Property tests: fast-check feeds each function hundreds of generated inputs, including the odd
// ones (empty, huge, malformed, any Unicode) that hand-written examples miss, and shrinks a failure
// to its smallest case. Everything a provider or a source answers is untrusted, so the property
// that recurs is: a valid answer or a ConnectorError, never a crash, and never the key in a message.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { TEST_KEY } from './__fixtures__/fake-fetch.js'
import { DATE_FORMATS, type CustomSource } from './custom/definition.js'
import { buildUrl, customHistory } from './custom/history.js'
import { parseDate, parseNumber, splitCsv } from './custom/parse.js'
import { addDays, daysBetween, fromUnixSeconds, isIsoDate, toIsoDate, toUnixSeconds } from './protocol/dates.js'
import { ConnectorError } from './protocol/errors.js'
import { LIMITS, type HistoryAnswer, type ProviderId } from './protocol/types.js'
import { isValidSymbol, validateRequest } from './protocol/validate.js'
import { clearAlphaVantageCurrencyCache } from './providers/alphavantage.js'
import { clearEodhdCurrencyCache } from './providers/eodhd.js'
import { clearFinnhubCurrencyCache } from './providers/finnhub.js'
import { ADAPTERS } from './providers/registry.js'
import { finalizeSeries } from './providers/series.js'
import type { FetchLike } from './providers/types.js'
import { cleanText } from './sanitize.js'

const FROM = '2026-01-01'
const TO = '2026-10-26'
const NOW = () => new Date('2026-10-26T12:00:00Z')

const dateBetween = (min: string, max: string) =>
  fc.date({ min: new Date(`${min}T00:00:00Z`), max: new Date(`${max}T00:00:00Z`), noInvalidDate: true }).map(toIsoDate)
/** Any real calendar date from 1900 to 2100. */
const anyDate = dateBetween('1900-01-01', '2100-12-31')
/** Dates around FROM..TO, so generated rows often land in the range asked for. */
const nearDate = dateBetween('2025-12-01', '2026-11-30')
/** A date as a source might write it: right, wrong, or not a date at all. */
const dateish = fc.oneof(nearDate, fc.string(), fc.jsonValue())
/** A price as a source might write it. */
const closeish = fc.oneof(fc.double(), fc.double().map(String), fc.string(), fc.jsonValue())
const status = fc.oneof(fc.constant(200), fc.integer({ min: 100, max: 599 }))
/** Symbols the protocol lets through to a provider or a source. */
const symbol = fc.stringMatching(/^[A-Za-z0-9 .\-_:/^=&+]{1,64}$/).filter(isValidSymbol)

/** Garbage, any JSON, and the shapes the providers and sources really answer with. Some echo the key. */
const answerText = fc.oneof(
  fc.string({ unit: 'binary' }),
  fc.jsonValue().map((v) => JSON.stringify(v)),
  fc.constant(`{"error":"The key ${TEST_KEY} is not valid"}`),
  fc.array(fc.record({ date: dateish, close: closeish }), { maxLength: 30 }).map((rows) => JSON.stringify(rows)),
  fc.array(fc.record({ date: dateish, close: closeish }), { maxLength: 30 }).map((rows) => JSON.stringify({ data: rows })),
  fc
    .record({ currency: fc.oneof(fc.constantFrom('USD', 'GBp', 'ZAc'), fc.string()), rows: fc.array(fc.record({ datetime: dateish, close: closeish }), { maxLength: 30 }) })
    .map(({ currency, rows }) => JSON.stringify({ status: 'ok', meta: { currency }, values: rows })),
  fc
    .dictionary(fc.oneof(nearDate, fc.string()), fc.record({ '4. close': closeish }), { maxKeys: 30 })
    .map((series) => JSON.stringify({ 'Time Series (Daily)': series })),
  fc
    .array(fc.tuple(fc.integer({ min: 1_760_000_000, max: 1_800_000_000 }), closeish), { maxLength: 30 })
    .map((rows) => JSON.stringify({ s: 'ok', t: rows.map(([t]) => t), c: rows.map(([, c]) => c), currency: 'USD' })),
  fc
    .array(fc.tuple(dateish, closeish), { maxLength: 30 })
    .map((rows) => ['date,close', ...rows.map(([d, c]) => `${String(d)},${String(c)}`)].join('\n')),
)

/** A fetch that gives every request the same answer. */
function answering(code: number, text: string): FetchLike {
  return async () => ({ status: code, ok: code >= 200 && code < 300, headers: { get: () => null }, body: null, text: async () => text })
}

async function settle<T>(promise: Promise<T>): Promise<{ answer: T } | { error: unknown }> {
  return promise.then(
    (answer) => ({ answer }),
    (error: unknown) => ({ error }),
  )
}

/** A history the app can trust: real dates in range, ascending, one per day, prices above zero. */
function expectValidHistory(answer: HistoryAnswer, from: string, to: string): void {
  expect(answer.currency).toMatch(/^[A-Z]{3}$/)
  expect(answer.prices.length).toBeLessThanOrEqual(LIMITS.historyPoints)
  let previous = ''
  for (const p of answer.prices) {
    expect(isIsoDate(p.date) && p.date >= from && p.date <= to && p.date > previous).toBe(true)
    expect(Number.isFinite(p.close) && p.close > 0).toBe(true)
    previous = p.date
  }
}

/** A failure the app can show: a ConnectorError whose message never holds the key. */
function expectCleanFailure(error: unknown): void {
  expect(error).toBeInstanceOf(ConnectorError)
  expect((error as ConnectorError).message).not.toContain(TEST_KEY)
}

describe('dates', () => {
  it('moves by whole days and back', () => {
    fc.assert(
      fc.property(anyDate, fc.integer({ min: -20_000, max: 20_000 }), (date, days) => {
        const moved = addDays(date, days)
        expect(isIsoDate(moved)).toBe(true)
        expect(daysBetween(date, moved)).toBe(days)
        expect(addDays(moved, -days)).toBe(date)
      }),
    )
  })

  it('turns into Unix seconds and back', () => {
    fc.assert(
      fc.property(anyDate, (date) => {
        expect(fromUnixSeconds(toUnixSeconds(date))).toBe(date)
      }),
    )
  })
})

describe("reading a source's dates and prices", () => {
  it('reads a date in every format a source can choose', () => {
    fc.assert(
      fc.property(dateBetween('1970-01-02', '2100-12-31'), (date) => {
        const [y, m, d] = date.split('-') as [string, string, string]
        expect(parseDate(`${date}T00:00:00Z`, 'YYYY-MM-DD')).toBe(date)
        expect(parseDate(`${y}${m}${d}`, 'YYYYMMDD')).toBe(date)
        expect(parseDate(`${d}/${m}/${y}`, 'DD/MM/YYYY')).toBe(date)
        expect(parseDate(`${Number(m)}/${Number(d)}/${y}`, 'MM/DD/YYYY')).toBe(date)
        expect(parseDate(`${d}.${m}.${y}`, 'DD.MM.YYYY')).toBe(date)
        expect(parseDate(toUnixSeconds(date), 'unix')).toBe(date)
        expect(parseDate(String(toUnixSeconds(date) * 1000), 'unixms')).toBe(date)
      }),
    )
  })

  it('gives a real date or nothing, whatever it is handed', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), fc.jsonValue(), fc.double()), fc.constantFrom(...DATE_FORMATS), (value, format) => {
        const date = parseDate(value, format)
        expect(date === undefined || isIsoDate(date)).toBe(true)
      }),
    )
  })

  it('reads back any number written as text', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        const expected = n === 0 ? 0 : n
        expect(parseNumber(String(n), '.')).toBe(expected)
        expect(parseNumber(String(n).replace('.', ','), ',')).toBe(expected)
      }),
    )
  })

  it('reads prices written with thousands separators', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_000 }), fc.constantFrom(['en-US', '.'], ['de-DE', ','], ['fr-FR', ',']), (cents, [locale, decimal]) => {
        const price = cents / 100
        const written = price.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        expect(parseNumber(written, decimal as '.' | ',')).toBe(price)
      }),
    )
  })

  it('gives a finite number or nothing, whatever it is handed', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), fc.jsonValue()), fc.constantFrom('.' as const, ',' as const), (value, decimal) => {
        const n = parseNumber(value, decimal)
        expect(n === undefined || Number.isFinite(n)).toBe(true)
      }),
    )
  })
})

describe('CSV', () => {
  it('reads back any table written as CSV', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string({ unit: 'binary' }), { minLength: 1, maxLength: 6 }), { maxLength: 20 }),
        fc.constantFrom(',', ';', '\t'),
        fc.constantFrom('\n', '\r\n'),
        fc.boolean(),
        (rows, delimiter, newline, bom) => {
          const text = (bom ? '\ufeff' : '') + rows.map((r) => r.map((f) => `"${f.replaceAll('"', '""')}"`).join(delimiter)).join(newline)
          // A row holding one empty field is a blank line, which the reader skips.
          expect(splitCsv(text, delimiter)).toEqual(rows.filter((r) => !(r.length === 1 && r[0] === '')))
        },
      ),
    )
  })

  it('never fails on text that is not CSV', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 2_000 }), fc.constantFrom(',', ';', '\t'), (text, delimiter) => {
        for (const row of splitCsv(text, delimiter)) expect(row.length === 1 && row[0] === '').toBe(false)
      }),
    )
  })
})

describe('price series', () => {
  it('keeps only real, ascending, positive prices within the range', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ date: dateish, close: closeish }), { maxLength: 200 }), nearDate, nearDate, fc.constantFrom(1, 100), (rows, a, b, divisor) => {
        const [from, to] = a <= b ? [a, b] : [b, a]
        expectValidHistory({ symbol: 'X', currency: 'USD', prices: finalizeSeries(rows, { from, to, divisor }) }, from, to)
      }),
    )
  })
})

describe('custom sources', () => {
  const base = { id: 'custom-1', name: 'Example source', dateFormat: 'YYYY-MM-DD', decimal: '.' } as const
  const JSON_SOURCE: CustomSource = {
    ...base,
    url: 'https://data.example.com/v1/prices/{SYMBOL}/daily?from={FROM}&to={TO}&key={KEY}',
    format: 'json',
    json: { items: 'data', date: 'date', close: 'close' },
    currency: 'USD',
    headers: {},
  }
  const CSV_SOURCE: CustomSource = {
    ...base,
    url: 'https://data.example.com/v1/prices.csv?symbol={SYMBOL}&from={FROM_UNIX}&to={TO_UNIX}',
    format: 'csv',
    csv: { date: 'date', close: 'close', delimiter: ',' },
    currency: 'GBp',
    headers: { Authorization: 'Bearer {KEY}' },
  }

  it('sends every request to the source\'s own host and path, whatever the symbol', () => {
    fc.assert(
      fc.property(symbol, (s) => {
        let path: URL
        try {
          path = new URL(buildUrl(JSON_SOURCE, { symbol: s, from: FROM, to: TO, key: TEST_KEY }))
        } catch (e) {
          expect(e).toBeInstanceOf(ConnectorError)
          return
        }
        expect(path.host).toBe('data.example.com')
        expect(path.pathname.startsWith('/v1/prices/')).toBe(true)
        expect(path.searchParams.get('key')).toBe(TEST_KEY)
        const query = new URL(buildUrl(CSV_SOURCE, { symbol: s, from: FROM, to: TO }))
        expect(query.host).toBe('data.example.com')
        expect(query.searchParams.get('symbol')).toBe(s)
      }),
    )
  })

  it('answers with valid prices or a clean error, whatever the source sends', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(JSON_SOURCE, CSV_SOURCE), status, answerText, async (source, code, text) => {
        const outcome = await settle(customHistory(source, 'ABC', FROM, TO, { key: TEST_KEY, fetch: answering(code, text), now: NOW }))
        if ('answer' in outcome) expectValidHistory(outcome.answer, FROM, TO)
        else expectCleanFailure(outcome.error)
      }),
    )
  })
})

describe('built-in providers', () => {
  const SYMBOLS: Record<ProviderId, string> = { eodhd: 'AAPL.US', twelvedata: 'AAPL', alphavantage: 'IBM', finnhub: 'AAPL' }
  const clearCaches = () => {
    clearEodhdCurrencyCache()
    clearFinnhubCurrencyCache()
    clearAlphaVantageCurrencyCache()
  }

  it.each(Object.values(ADAPTERS).map((a) => [a.name, a] as const))('%s: valid prices or a clean error, whatever it answers', async (_name, adapter) => {
    await fc.assert(
      fc
        .asyncProperty(status, answerText, async (code, text) => {
          const ctx = { apiKey: TEST_KEY, fetch: answering(code, text), now: NOW }
          const history = await settle(adapter.history(SYMBOLS[adapter.id], FROM, TO, ctx))
          if ('answer' in history) expectValidHistory(history.answer, FROM, TO)
          else expectCleanFailure(history.error)
          const search = await settle(adapter.search('apple', ctx))
          if ('answer' in search) expect(search.answer.length).toBeLessThanOrEqual(LIMITS.searchResults)
          else expectCleanFailure(search.error)
        })
        .beforeEach(clearCaches),
    )
  })
})

describe('requests from the app', () => {
  // Strings carry this mark, so an error message that echoed the request would show it.
  const MARK = '<echo>'
  const text = fc.oneof(fc.string(), fc.string().map((s) => s + MARK))
  const request = fc.oneof(
    fc.jsonValue(),
    fc.record(
      {
        v: fc.constantFrom(1, 2, '1'),
        id: fc.oneof(fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/), text),
        op: fc.oneof(fc.constantFrom('hello', 'search', 'history', 'openSettings'), text),
        params: fc.record(
          {
            provider: fc.oneof(fc.constantFrom('eodhd', 'twelvedata', 'alphavantage', 'finnhub', 'custom-1'), text),
            query: fc.oneof(fc.stringMatching(/^[A-Za-z0-9 ]{1,64}$/), text),
            symbol: fc.oneof(symbol, text),
            from: fc.oneof(anyDate, text),
            to: fc.oneof(anyDate, text, fc.constant(null)),
          },
          { requiredKeys: [] },
        ),
      },
      { requiredKeys: [] },
    ),
  )

  it('accepts a well-formed request or refuses it with a protocol error that does not echo it', () => {
    fc.assert(
      fc.property(request, (input) => {
        let valid: ReturnType<typeof validateRequest>
        try {
          valid = validateRequest(input, NOW())
        } catch (e) {
          expect(e).toBeInstanceOf(ConnectorError)
          expect(['BAD_REQUEST', 'UNSUPPORTED_PROTOCOL', 'UNSUPPORTED_OPERATION']).toContain((e as ConnectorError).code)
          expect((e as ConnectorError).message).not.toContain(MARK)
          return
        }
        if (valid.op === 'search') expect(valid.params.query.length).toBeLessThanOrEqual(LIMITS.queryLength)
        if (valid.op === 'history') {
          const { symbol: s, from, to } = valid.params
          expect(isValidSymbol(s)).toBe(true)
          expect(isIsoDate(from)).toBe(true)
          expect(to === undefined || (isIsoDate(to) && to >= from)).toBe(true)
        }
      }),
    )
  })
})

describe('text shown in the app', () => {
  it('keeps no control or invisible characters, and keeps to the limit', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.integer({ min: 1, max: 300 }), (value, max) => {
        const cleaned = cleanText(value, max)
        if (cleaned === undefined) return
        expect(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(cleaned)).toBe(false)
        expect(Array.from(cleaned).length).toBeLessThanOrEqual(max)
        expect(cleaned.length > 0 && cleaned === cleaned.trim()).toBe(true)
      }),
    )
  })
})
