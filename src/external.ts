import { dispatch, type DispatchDeps } from './shared/dispatch.js'
import type { ConnectorResponse } from './shared/protocol/types.js'

export interface SenderLike {
  id?: string
  origin?: string
  url?: string
}

/** The web origin a message came from, from `sender.origin` or, in older Chrome, `sender.url`. */
export function senderOrigin(sender: SenderLike): string | undefined {
  if (typeof sender.origin === 'string' && sender.origin !== 'null') return sender.origin
  if (typeof sender.url === 'string') {
    try {
      return new URL(sender.url).origin
    } catch {
      return undefined
    }
  }
  return undefined
}

const REFUSED: ConnectorResponse = {
  id: '',
  ok: false,
  error: { code: 'BAD_REQUEST', message: 'The Turbobulls Connector only answers the Turbobulls app.' },
}

/**
 * Answers messages from web pages. The manifest already limits who can send, and this checks the
 * exact origin again (with its port), so another extension or any other page gets nothing.
 */
export function createExternalHandler(opts: { allowedOrigins: readonly string[]; deps: DispatchDeps }) {
  return async (message: unknown, sender: SenderLike): Promise<ConnectorResponse> => {
    const origin = senderOrigin(sender)
    if (!origin || !opts.allowedOrigins.includes(origin)) return REFUSED
    return dispatch(message, opts.deps)
  }
}
