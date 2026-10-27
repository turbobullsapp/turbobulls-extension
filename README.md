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
| `storage` | To keep your API keys and your own sources in this browser, on this device. Never synced to your browser account. |
| `eodhd.com`, `api.twelvedata.com`, `www.alphavantage.co`, `finnhub.io` | To call your provider's API. |
| Optional: one `https://` site at a time | Only when you add your own source, and only for its site. Chrome asks you first; removing the source gives the permission back. |

- **It cannot read any web page**, Turbobulls included. It has no content scripts and no access to
  your tabs.
- **Only `https://app.turbobulls.com` can talk to it** (`externally_connectable`). Chrome does not
  even show the extension to other websites, and the extension checks again that the sender is the
  app's own page, not a frame or a sandboxed page.
- **The app can never send it a web address.** The app can only ask for a search or for prices
  from one of the four providers or a source you added yourself on the settings page, so the
  extension cannot be used to reach anything else. It never follows a redirect.
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

## Your own sources

For prices none of the four providers carry (a pension fund's daily price, a small exchange, a
spreadsheet you keep yourself), add a source on the settings page: any `https://` address that
answers JSON or CSV. You give it a name, the address with placeholders (`{SYMBOL}`, `{FROM}`,
`{TO}`, `{FROM_UNIX}`, `{TO_UNIX}`, `{KEY}`), where the date and the price sit in the answer, the
date format, the currency, and a key if the source needs one. **Try it** fetches the last 30 days
and shows what it read, or why nothing matched.

In Turbobulls, the source appears among your data providers. It has no search: you type the symbol
(the source's settings can say what to type, like "Fund code"). Turbobulls sees the source's name,
never its address or key. The extension never follows a redirect, so give it the address the data
finally comes from. Use only sources whose terms allow this use. The settings mirror the bridge's config format, described in the
[turbobulls-bridge README](https://github.com/turbobullsapp/turbobulls-bridge#custom-sources).

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
