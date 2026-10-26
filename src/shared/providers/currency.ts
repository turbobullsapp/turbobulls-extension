/**
 * Some exchanges quote in a hundredth of their currency: London in pence (GBp, GBX), Johannesburg
 * in cents (ZAc), Tel Aviv in agorot (ILA). Turbobulls holds major units only, so prices in these
 * are divided by 100 and reported in GBP, ZAR and ILS. The codes are case sensitive: GBP is
 * pounds, GBp is pence.
 */
const MINOR_UNITS: ReadonlyMap<string, string> = new Map([
  ['GBp', 'GBP'],
  ['GBX', 'GBP'],
  ['GBx', 'GBP'],
  ['ZAc', 'ZAR'],
  ['ZAC', 'ZAR'],
  ['ILA', 'ILS'],
  ['ILa', 'ILS'],
])

export interface MajorCurrency {
  /** ISO code in major units: always three capital letters. */
  currency: string
  /** What the provider's prices are divided by: 100 for pence, cents and agorot, else 1. */
  divisor: number
}

const ISO_CODE = /^[A-Z]{3}$/

/** The major currency for a provider's code, or undefined when there is none ("NA", empty, junk). */
export function toMajor(code: unknown): MajorCurrency | undefined {
  if (typeof code !== 'string') return undefined
  const c = code.trim()
  const major = MINOR_UNITS.get(c)
  if (major) return { currency: major, divisor: 100 }
  const upper = c.toUpperCase()
  if (!ISO_CODE.test(upper) || upper === 'NAN') return undefined
  return { currency: upper, divisor: 1 }
}
