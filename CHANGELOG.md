# Changelog

## 2.0.0 (unreleased)

A rewrite. Nothing from 1.x is kept.

- Zero dependencies (1.x needed jQuery), written in TypeScript, about 2.5 KB min+brotli.
- `init({ endpoint })` replaces editing the source to set the URL.
- Captures uncaught errors, failed resource loads, unhandled rejections, failed `fetch` and `XMLHttpRequest` calls, and optionally `console.error` / `console.warn`.
- Errors are serialized with name, message, stack and `cause` (1.x sent `{}` for `Error` objects).
- Batching, retry with backoff, an in-memory queue cap, and a flush that survives page unload (`sendBeacon` / `fetch(keepalive)`).
- Dedupe by fingerprint, sampling, default redaction of emails and secrets, `beforeSend`.
- `setUser`, `setContext`, `app`, `release`.
- React `ErrorBoundary`, Vue plugin and Angular `ErrorHandler` adapters.
- Receiver examples for Node (zero dependencies) and ASP.NET Core.
- Published to npm as `@lucaslobasso/js-logger`, with a `<script>` build on jsDelivr / unpkg.
