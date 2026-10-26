# Turbobulls Connector

Prices from **your own** market-data subscription, for [Turbobulls](https://turbobulls.com).

If you pay for a data provider (EODHD, Twelve Data, Alpha Vantage or Finnhub), this browser
extension lets Turbobulls price assets it does not cover with that provider's data. Your API key
stays in your browser. Turbobulls never sees it, and never sees which symbols you look up: the app
asks the extension, the extension asks your provider, and only the prices come back.

Chrome and Edge. For Firefox, or if you prefer a program to an extension, use
[turbobulls-bridge](https://github.com/turbobullsapp/turbobulls-bridge) instead.

## What it can and cannot do

| Permission | Why |
|---|---|
| `storage` | To keep your API keys in this browser, on this device. Never synced to your browser account. |
| `eodhd.com`, `api.twelvedata.com`, `www.alphavantage.co`, `finnhub.io` | To call your provider's API. Nothing else. |

- **It cannot read any web page**, Turbobulls included. It has no content scripts and no access to
  your tabs.
- **Only `https://app.turbobulls.com` can talk to it** (`externally_connectable`). Chrome does not
  even show the extension to other websites, and the extension checks again that the sender is the
  app's own page, not a frame or a sandboxed page.
- **It never accepts a web address to fetch.** The app can only ask for a search or for prices
  from one of the four providers, so the extension cannot be used to reach anything else.
- **Your key is sent only to its own provider**, in a header where the provider accepts one, never
  follows a redirect elsewhere, and never appears in an answer, a message or a log.

## Install

From the Chrome Web Store (Chrome and Edge), once the listing is live. The Turbobulls app talks
only to the store version: a copy loaded by hand gets a different extension id, which the app does
not know, and that is on purpose (the app must never trust an id anyone could claim).

To try it before the listing, build the development version and run the app's local dev server,
which knows the development id (see Development below).

## Use it

1. Click the extension's icon. On the page that opens, paste your provider's API key and press
   **Save**. The extension checks the key with one small request.
2. In Turbobulls, open a custom asset, choose **From my data provider**, search for the symbol and
   pick it.

Turbobulls refreshes linked prices while the app is open in a browser with the extension, and your
other devices (your phone included) receive them through the app's normal encrypted sync. What you
can price depends on your plan with the provider.

## How it works

The app and the extension speak a small protocol: `hello`, `search`, `history` and
`openSettings`. See [PROTOCOL.md](PROTOCOL.md). The provider code in `src/shared/` is identical in
turbobulls-bridge.

## Development

```bash
pnpm install
pnpm check        # typecheck, lint, test, store builds for Chrome and Edge
pnpm build:dev    # development build in .output/chrome-mv3-dev
pnpm dev-id       # prints the development extension id
```

A development build also answers the app's local dev server (`http://localhost:3000`) and always
has the id `flnofeaegigjpjinmbhlfgagajconknk`, so the app can address it. Point the app's dev
server at it with `NEXT_PUBLIC_CONNECTOR_EXTENSION_IDS=flnofeaegigjpjinmbhlfgagajconknk`. Store
builds have neither, and the production app must never list the development id: anyone can build
an extension with it from the public key in `src/dev-key.ts`.

`pnpm dev` (live reload) adds permissions WXT needs for reloading; never ship its output. Releases
are built with `pnpm zip`, which makes store builds.

## License

[MIT](LICENSE)
