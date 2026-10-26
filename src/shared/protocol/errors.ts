import type { ConnectorErrorBody, ErrorCode } from './types.js'

/** An error a connector reports to the app as `{ ok: false, error }`. */
export class ConnectorError extends Error {
  readonly code: ErrorCode
  readonly retryAfter: number | undefined

  constructor(code: ErrorCode, message: string, retryAfter?: number) {
    super(message)
    this.name = 'ConnectorError'
    this.code = code
    this.retryAfter = retryAfter
  }

  toBody(): ConnectorErrorBody {
    return this.retryAfter === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, retryAfter: this.retryAfter }
  }
}

export function isConnectorError(e: unknown): e is ConnectorError {
  return e instanceof ConnectorError
}
