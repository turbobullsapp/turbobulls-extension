# Turbobulls connector protocol, version 1

The Turbobulls app asks a connector for prices: the Turbobulls Connector browser extension, or
`turbobulls-bridge` on your own computer. This document is the whole contract between them. The
same file lives in both connector repositories.

The app never sees an API key. A connector holds the key, calls the provider, and hands back only
search results and daily closing prices.

## Transports

**Extension.** The app calls `chrome.runtime.sendMessage(extensionId, request)` and the extension
answers from `chrome.runtime.onMessageExternal`. Only pages on `https://app.turbobulls.com` can send
it a message (`externally_connectable` in the manifest), and the extension checks the sender's
origin again before answering. The extension has no content script: it cannot read any page.

**Bridge.** `GET http://127.0.0.1:47821/v1/<op>` with the parameters as query parameters
(`provider`, `query`, `symbol`, `from`, `to`), plus optional `id` and `v`. Every protocol answer,
success or error, comes with HTTP 200 and a JSON body. The bridge refuses, with 403 and no CORS
headers, any request whose `Origin` is not `https://app.turbobulls.com` (or
`http://localhost:3000` when started with `--dev`), any request without an `Origin`, and any
request whose `Host` is not `127.0.0.1:47821` or `localhost:47821`.

## Envelope

Request:

```json
{ "v": 1, "id": "r-42", "op": "history", "params": { "provider": "eodhd", "symbol": "AAPL.US", "from": "2026-10-01" } }
```

- `v`: the protocol version, `1`.
- `id`: 1 to 64 characters from `A-Z a-z 0-9 _ -`. The answer carries the same `id`.
- `op`: `hello`, `search`, `history` or `openSettings`.

Answer, success:

```json
{ "id": "r-42", "ok": true, "result": { } }
```

Answer, failure:

```json
{ "id": "r-42", "ok": false, "error": { "code": "RATE_LIMITED", "message": "EODHD asked to slow down.", "retryAfter": 60 } }
```

`message` is plain English for people. It never contains a key or a provider URL.

Every string in an answer (names, exchanges, types, messages) comes from a provider or a connector
and is untrusted plain text: show it as text, never as HTML. Connectors strip control characters
and cap names at 200 characters, and drop any search result whose `symbol` they would not accept
back in a `history` request.

## Operations

### hello

No parameters. Tells the app which connector this is and which providers have a key.

```json
{
  "protocol": 1,
  "connector": "bridge",
  "version": "0.1.0",
  "providers": [
    { "id": "eodhd", "name": "EODHD", "configured": true, "capabilities": { "search": true, "history": true } },
    { "id": "twelvedata", "name": "Twelve Data", "configured": false, "capabilities": { "search": true, "history": true } }
  ]
}
```

### search

Parameters: `provider` (`eodhd`, `twelvedata`, `alphavantage`, `finnhub`, or a custom source, which
cannot search; see Custom sources) and `query` (1 to 64 characters, at least one letter or digit).

```json
{ "results": [ { "symbol": "TSCO.LSE", "name": "Tesco PLC", "exchange": "LSE", "currency": "GBP", "type": "Common Stock", "isin": "GB00BLGZ9862" } ] }
```

At most 50 results. `symbol` is what to pass back to `history`. `currency` is in major units (see
below) and may be missing when the provider does not say. `exchange`, `mic`, `type` and `isin` are
optional.

### history

Parameters: `provider`, `symbol` (as a search returned it), `from` and optionally `to`, both
`YYYY-MM-DD`. `to` defaults to today; a `to` later than tomorrow is treated as tomorrow.

```json
{ "symbol": "AAPL.US", "currency": "USD", "prices": [ { "date": "2026-10-22", "close": 348.22 }, { "date": "2026-10-23", "close": 347.72 } ] }
```

- One point per trading day, ascending by date, at most 20,000 points (the newest are kept).
- `close` is the **as-traded** closing price, never adjusted for splits or dividends, in **major
  units**. Prices quoted in pence (GBp, GBX), South African cents (ZAc) or agorot (ILA) are divided
  by 100 and reported in GBP, ZAR or ILS.
- The point for today may be the latest price so far; a later request for the same day returns the
  final close.
- An empty `prices` list means the provider has no prices in that range (a holiday, a range before
  the listing began). It is not an error.

### openSettings

No parameters. The extension opens its settings page and answers `{ "opened": true }`. The bridge
answers `UNSUPPORTED_OPERATION`; its keys live in its config file.

## Custom sources

Besides the four built-in providers, a user can define their own sources in a connector: a web
address with placeholders, the format of the answer (JSON or CSV), where the date and the price sit
in it, and the currency. They are defined only in the connector (the extension's settings page or
the bridge's config file); the app cannot add, change or read them, and never sends an address.

A custom source appears in `hello.providers` like this:

```json
{ "id": "mypension", "name": "My pension fund", "configured": true, "custom": true, "symbolHint": "Fund code", "capabilities": { "search": false, "history": true } }
```

- `id`: 2 to 32 lower-case letters and digits, starting with a letter, never a built-in id.
- `custom: true` marks it; `symbolHint` (optional, up to 64 characters) is how the user described
  what to type as the symbol, for the app to use as the label of its symbol box.
- `search` on a custom source answers `UNSUPPORTED_OPERATION`: the user types the symbol.
- `history` works as for any provider. `symbol` is what the user typed (same character rules as
  any symbol); the connector puts it into the source's address only where the address asks for it,
  and answers with the currency the user configured for the source.
- A connector lists at most 12 custom sources, so `hello` never lists more than 16 providers.

Error codes keep their meaning: `INVALID_KEY` when the source refuses the user's key, `NOT_FOUND`
for a symbol it does not know, `PROVIDER_ERROR` when its answer has no dates and prices where the
source settings point.

## Error codes

| Code | Meaning | What the app does |
|---|---|---|
| `NOT_CONFIGURED` | No key for this provider, or no custom source with that id, in this connector | Ask the user to set it up in the connector |
| `INVALID_KEY` | The provider refused the key | Stop asking this provider until the user changes the key |
| `PLAN_LIMIT` | The user's plan does not include this data | Tell the user; do not retry soon |
| `RATE_LIMITED` | The provider asked to slow down, or today's allowance is used up | Wait `retryAfter` seconds before asking this provider again |
| `NOT_FOUND` | The provider does not know this symbol, or does not say its currency | Tell the user; do not retry soon |
| `PROVIDER_ERROR` | The provider failed, timed out or sent something unusable | Retry later with backoff |
| `BAD_REQUEST` | The request was malformed | Fix the app |
| `UNSUPPORTED_PROTOCOL` | The request's `v` is not one this connector speaks | Ask the user to update the connector or the app |
| `UNSUPPORTED_OPERATION` | Unknown `op`, or `openSettings` on the bridge | Do not ask again |

A connector answers `RATE_LIMITED`, `INVALID_KEY` and `PLAN_LIMIT` itself, without asking the
provider again, while the provider's refusal still applies: a rate limit until `retryAfter` passes
(an hour at most, with `retryAfter` still counting down to the provider's time), a refused key for
five minutes or until the user changes it, a symbol outside the user's plan for five minutes. The
answer is the one the provider's refusal produced.

## Symbols by provider

Always pass back the `symbol` a search returned. For reference:

| Provider | Format | Examples |
|---|---|---|
| EODHD | `CODE.EXCHANGE` | `AAPL.US`, `TSCO.LSE`, `SE0021021417.EUFUND`, `BTC-USD.CC`, `EURUSD.FOREX` |
| Twelve Data | `SYMBOL:EXCHANGE`, or a pair | `TSCO:LSE`, `AAPL:NASDAQ`, `BTC/USD:Coinbase Pro`, `EUR/USD` |
| Alpha Vantage | `SYMBOL`, with a market suffix outside the US | `IBM`, `TSCO.LON` |
| Finnhub | `SYMBOL` | `AAPL` |

## Keys

Keys never cross the protocol: no operation takes a key or returns one, and no operation takes a
URL. A connector builds every provider request itself from the provider, the symbol and the dates,
so it cannot be used to reach anything else.

## Versions

A change that existing apps or connectors would misread gets a new `v`. A connector answers a `v`
it does not speak with `UNSUPPORTED_PROTOCOL`.
