# Shared code

This folder is identical in `turbobulls-bridge` and `turbobulls-extension`. It holds the connector
protocol (`protocol/`), the provider adapters (`providers/`) and the request handler both
connectors run (`dispatch.ts`).

Rules for anything in here:

- It must run unchanged in Node 22+ and in a browser extension service worker: no Node modules,
  no DOM, no `Buffer`, no `process`. Network access only through the `fetch` the caller passes in.
- An API key is only ever used to build a provider request. It never goes into a URL when the
  provider accepts it in a header, never into an error message, never into a log line.
- A change here is made in both repositories.
