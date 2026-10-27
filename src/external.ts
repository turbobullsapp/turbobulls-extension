import { dispatch, type DispatchDeps } from './shared/dispatch.js'
import type { ConnectorResponse } from './shared/protocol/types.js'

export interface SenderLike {
  id?: string
  origin?: string
  url?: string
  frameId?: number
}

/**
 * The web origin a message came from: `sender.origin` only. A sandboxed frame or page reports the
 * origin "null" while its URL still looks like the app's, so the URL is never used as a fallback.
 */
export function senderOrigin(sender: SenderLike): string | undefined {
  return typeof sender.origin === 'string' && sender.origin !== 'null' ? sender.origin : undefined
}

const REFUSED: ConnectorResponse = {
  id: '',
  ok: false,
  error: { code: 'BAD_REQUEST', message: 'The Turbobulls Connector only answers the Turbobulls app.' },
}

/**
 * Answers messages from web pages. The manifest already limits who can send, and this checks the
 * exact origin again (with its port) and that the sender is the page itself, not a frame inside
 * it, so another extension, a frame or any other page gets nothing.
 */
export function createExternalHandler(opts: {
  allowedOrigins: readonly string[]
  deps: DispatchDeps
  /** Called after prices went to the app, so the settings page can show the setup is complete. */
  onPricesSent?: () => void | Promise<void>
}) {
  return async (message: unknown, sender: SenderLike): Promise<ConnectorResponse> => {
    const origin = senderOrigin(sender)
    if (!origin || !opts.allowedOrigins.includes(origin) || sender.frameId !== 0) return REFUSED
    const answer = await dispatch(message, opts.deps)
    const op = typeof message === 'object' && message !== null ? (message as { op?: unknown }).op : undefined
    if (answer.ok && op === 'history') await Promise.resolve(opts.onPricesSent?.()).catch(() => undefined)
    return answer
  }
}
