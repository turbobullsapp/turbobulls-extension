# Changelog

All notable changes are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), as [RELEASING.md](RELEASING.md) explains.

## [Unreleased]

## [1.1.0] - 2026-11-14

### Added

- A source of your own can read a file served on your own computer: its address may start with
  `http://localhost` or `http://127.0.0.1`, on any port. Every other address still needs
  `https://`. The extension asks once for permission to reach that address when such a source is
  saved.
- Each GitHub release carries the packages' signed build record as a file,
  `turbobulls-extension-<version>.sigstore.json`, to check a download against.

## [1.0.2] - 2026-10-29

### Changed

- The line under Twelve Data on the settings page says that showing its prices needs a paid
  plan.

## [1.0.0] - 2026-10-27

The first public release. It speaks version 1 of the protocol in [PROTOCOL.md](PROTOCOL.md).

### Added

- Prices for custom assets in Turbobulls from your own market-data provider, with your own API
  key: EODHD, Twelve Data, Alpha Vantage and Finnhub.
- Sources of your own: any `https://` address that answers JSON or CSV, each site allowed one at a
  time when you save it, with the European Central Bank's euro rates as a ready example.
- A settings page: the three steps to set up, one row per provider with its key field, a test of
  each key with one small request, and how your keys and data are kept private.
- Talks only to `https://app.turbobulls.com`; cannot read any web page.

[Unreleased]: https://github.com/turbobullsapp/turbobulls-extension/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/turbobullsapp/turbobulls-extension/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/turbobullsapp/turbobulls-extension/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/turbobullsapp/turbobulls-extension/releases/tag/v1.0.0
