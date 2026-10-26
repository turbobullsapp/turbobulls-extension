/**
 * The connector protocol, version 1. The Turbobulls app speaks only this to a connector (the
 * browser extension or the bridge). See PROTOCOL.md for the prose version.
 */

export const PROTOCOL_VERSION = 1

export const PROVIDER_IDS = ['eodhd', 'twelvedata', 'alphavantage', 'finnhub'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export const OPS = ['hello', 'search', 'history', 'openSettings'] as const
export type Op = (typeof OPS)[number]

export type ConnectorKind = 'extension' | 'bridge'

export const ERROR_CODES = [
  'NOT_CONFIGURED',
  'INVALID_KEY',
  'PLAN_LIMIT',
  'RATE_LIMITED',
  'NOT_FOUND',
  'PROVIDER_ERROR',
  'BAD_REQUEST',
  'UNSUPPORTED_PROTOCOL',
  'UNSUPPORTED_OPERATION',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export const LIMITS = {
  /** Most search results one answer carries. */
  searchResults: 50,
  /** Most daily prices one history answer carries. */
  historyPoints: 20_000,
  queryLength: 64,
  symbolLength: 64,
  requestIdLength: 64,
} as const

export interface ConnectorRequest {
  v: number
  id: string
  op: Op
  params?: unknown
}

export interface ConnectorErrorBody {
  code: ErrorCode
  message: string
  /** Seconds to wait before asking this provider again. */
  retryAfter?: number
}

export type ConnectorResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: ConnectorErrorBody }

export interface ProviderInfo {
  id: ProviderId
  name: string
  configured: boolean
  capabilities: { search: boolean; history: boolean }
}

export interface HelloResult {
  protocol: typeof PROTOCOL_VERSION
  connector: ConnectorKind
  version: string
  providers: ProviderInfo[]
}

export interface SearchParams {
  provider: ProviderId
  query: string
}

export interface SearchResult {
  /** What to pass back in a history request, in the provider's own format. */
  symbol: string
  name: string
  exchange?: string
  mic?: string
  /** The currency prices will be reported in, in major units (GBP, never GBX). */
  currency?: string
  type?: string
  isin?: string
}

export interface SearchAnswer {
  results: SearchResult[]
}

export interface HistoryParams {
  provider: ProviderId
  symbol: string
  /** First date wanted, YYYY-MM-DD. */
  from: string
  /** Last date wanted, YYYY-MM-DD. Today when left out. */
  to?: string
}

export interface PricePoint {
  /** YYYY-MM-DD, the trading day. */
  date: string
  /** The unadjusted close in major units. Today's point may be the price so far. */
  close: number
}

export interface HistoryAnswer {
  symbol: string
  /** ISO currency code in major units (GBP, ZAR, ILS, never GBX, ZAc, ILA). */
  currency: string
  /** Ascending by date, one point per day. */
  prices: PricePoint[]
}
