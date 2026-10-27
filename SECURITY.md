# Security

## Reporting a problem

Please report security problems privately: use **Report a vulnerability** on this repository's
Security tab, or email hello@turbobulls.com. Do not open a public issue. Never paste an API key
into an issue, even a revoked one.

## Supported versions

Only the latest release gets fixes, security fixes included. Updating is the fix for a problem
found in an older version.

| Version | Fixes |
|---|---|
| 1.x (latest) | Yes |
| Older | No |

## What the extension is designed to guarantee

- **It cannot see any page.** No content scripts, no `tabs`, `scripting` or page host permissions.
  Even an update that turned malicious could not read a portfolio shown in Turbobulls.
- **Only the Turbobulls app can message it.** The manifest's `externally_connectable` names
  `https://app.turbobulls.com` alone, so Chrome hides the extension from every other website. The
  background checks again that the sender is the app's own top-level page (its exact origin, not
  a frame, not a sandboxed page reporting origin "null"), and other extensions are refused.
- **It cannot be used as a proxy.** No message carries a URL. The extension builds each provider
  request itself, for the four provider APIs and the sources you added on its settings page; the
  app can only name a source, never add one or change its address. A symbol is encoded and can
  never change the host or climb out of the address's path. Redirects are never followed, so a
  request, and any key or header in it, cannot be carried to another host. The extension stops
  reading any answer past a size limit and refuses answers with too many rows. No request ever
  sends cookies.
- **Your own sources reach only the sites you allowed.** The manifest can ask for `https://` sites
  only as optional permissions, one site at a time, when you save a source; Chrome asks you first.
  Before each request the extension checks that the site is still allowed. Sites no saved source
  needs (one allowed for a Try that was never saved, or one a source moved away from) are given back
  whenever sources change and whenever the settings page opens. A saved key stays with its site: a
  source moved to another site needs its key typed again. A site permission lets the extension
  fetch from that site; it still cannot read or change any page.
- **Your keys stay in your browser.** They live in `storage.local`: this device only, never
  synced, readable only by this extension. A key is sent only to its own provider, as a header
  where the provider accepts one (EODHD, Twelve Data, Finnhub). Alpha Vantage only accepts it in
  the address, which the extension never logs or reports. Keys never appear in answers to the app,
  in error messages or in logs.
- **Turbobulls learns nothing.** The extension never contacts Turbobulls. The app only sends it a
  provider name, a symbol and dates, never portfolio data. The app sees the names you give your own
  sources, never their addresses or keys.

## What it cannot protect against

- **Scripts on the Turbobulls app itself.** The extension trusts the app's page. If someone could
  run their own script on app.turbobulls.com, it could make searches and price requests with your
  keys (never read them).
- **Your own files.** Extension storage is not encrypted on disk, the same as the rest of your
  browser profile. Software running on your computer with your user's rights can read it.

Keep your computer and browser up to date.

## Releases

Releases are built by GitHub Actions from tagged commits of `main`, after a maintainer approves
them, and the store packages carry a signed record of where they were built.
[RELEASING.md](RELEASING.md) has the rules and the commands to check a release yourself.
