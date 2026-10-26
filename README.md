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
  even show the extension to other websites, and the extension checks the sender again.
- **It never accepts a web address to fetch.** The app can only ask for a search or for prices
  from one of the four providers, so the extension cannot be used to reach anything else.
- **Your key is sent only to its own provider**, in a header where the provider accepts one, and
  never appears in an answer, a message or a log.

## Install

Until the store listings are live, load it by hand:

1. Download `turbobulls-extension-<version>-chrome.zip` from the
   [releases](https://github.com/turbobullsapp/turbobulls-extension/releases) and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click
   **Load unpacked** and choose the unzipped folder.

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
has the id `flnofeaegigjpjinmbhlfgagajconknk`, so the app can address it. Point the app at it with
`NEXT_PUBLIC_CONNECTOR_EXTENSION_IDS=flnofeaegigjpjinmbhlfgagajconknk`. Store builds have neither.

## License

[MIT](LICENSE)
