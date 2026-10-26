/**
 * Some exchanges quote in a hundredth of their currency: London in pence (GBp, GBX), Johannesburg
 * in cents (ZAc), Tel Aviv in agorot (ILA). Turbobulls holds major units only, so prices in these
 * are divided by 100 and reported in GBP, ZAR and ILS. The codes are case sensitive: GBP is
 * pounds, GBp is pence.
 */
const MINOR_UNITS: Readonly<Record<string, string>> = {
  GBp: 'GBP',
  GBX: 'GBP',
  GBx: 'GBP',
  ZAc: 'ZAR',
  ZAC: 'ZAR',
  ILA: 'ILS',
  ILa: 'ILS',
}

export interface MajorCurrency {
  /** ISO code in major units. */
  currency: string
  /** What the provider's prices are divided by: 100 for pence, cents and agorot, else 1. */
  divisor: number
}

/** The major currency for a provider's code, or undefined when there is none ("NA", empty). */
export function toMajor(code: unknown): MajorCurrency | undefined {
  if (typeof code !== 'string') return undefined
  const c = code.trim()
  const major = MINOR_UNITS[c]
  if (major) return { currency: major, divisor: 100 }
  if (/^[A-Z]{3}$/.test(c)) return c === 'NAN' ? undefined : { currency: c, divisor: 1 }
  if (/^[a-z]{3}$/i.test(c)) return { currency: c.toUpperCase(), divisor: 1 }
  return undefined
}
