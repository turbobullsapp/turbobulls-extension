# Security

## Reporting a problem

Please report security problems privately: use **Report a vulnerability** on this repository's
Security tab, or email hello@turbobulls.com. Do not open a public issue. Never paste an API key
into an issue, even a revoked one.

## What the extension is designed to guarantee

- **It cannot see any page.** No content scripts, no `tabs`, `scripting` or page host permissions.
  Even an update that turned malicious could not read a portfolio shown in Turbobulls.
- **Only the Turbobulls app can message it.** The manifest's `externally_connectable` names
  `https://app.turbobulls.com` alone, so Chrome hides the extension from every other website. The
  background checks the sender's exact origin again before answering, and other extensions are
  refused.
- **It cannot be used as a proxy.** No message carries a URL. The extension builds each provider
  request itself, and its host permissions cover only the four provider APIs.
- **Your keys stay in your browser.** They live in `storage.local`: this device only, never
  synced, readable only by this extension. A key is sent only to its own provider, as a header
  where the provider accepts one (EODHD, Twelve Data, Finnhub). Alpha Vantage only accepts it in
  the address, which the extension never logs or reports. Keys never appear in answers to the app,
  in error messages or in logs.
- **Turbobulls learns nothing.** The extension never contacts Turbobulls. The app only sends it a
  provider name, a symbol and dates, never portfolio data.

## What it cannot protect against

Extension storage is not encrypted on disk, the same as the rest of your browser profile. Software
running on your computer with your user's rights can read it. Keep your computer up to date.

## Releases

Releases are built by GitHub Actions from tagged commits; the store packages are made from those
builds.
