# jsLogger (`js-logger`)

Tiny, zero-dependency browser error logger published to npm as `@lucaslobasso/js-logger`. It captures errors, rejections, failed fetch/XHR and resources, and batches them as JSON to the user's own endpoint. v2 is a full rewrite; nothing from the 2022 jQuery plugin is kept.

## Hard rules
- **No runtime dependencies** in the core, and stay under the `size-limit` budgets in `package.json` (`npm run size`).
- The logger must never log itself: its own requests go through the saved native `fetch`, `isOwn()` skips the endpoint in the fetch/XHR wrappers, and the `busy` flag blocks re-entry from `console.error`/`beforeSend`.
- Everything patched or listened to is registered through `patch()`/`listen()` so `teardown()` restores it.
- The active logger lives on `globalThis.__jsLogger__` (`src/util.ts`), so adapters bundled separately share it.
- Adapters (`src/react.ts`, `vue.ts`, `angular.ts`) import their framework as an optional peer and stay a few lines; no JSX, no decorators.
- The unload flush sends `text/plain` beacons on purpose (no CORS preflight). Receivers must parse the body as JSON whatever the content type; the examples and README say so.
- Run `npm run check` before committing. After visible changes to the demo, run `npm run screenshots`.

## Layout
- `src/core.ts` (`init`: options, capture, filter pipeline, transport, teardown), `src/util.ts` (active logger, serializeError, hash, redact), `src/types.ts`, `src/index.ts`.
- `test/` (vitest + happy-dom). `examples/node/server.mjs` (zero-dep receiver + demo server), `examples/browser/index.html` (demo page), `examples/aspnet-core/`.
- `docs/screenshots.mjs` → `docs/*.png` (headless Edge via playwright-core).
- `.github/workflows/ci.yml`; `release.yml` publishes on a `v*` tag matching package.json (needs the `NPM_TOKEN` secret).

## Machine notes
- TypeScript stays on 6.x: tsup's dts build needs the TS compiler API, which TS 7 doesn't ship.
- Install with `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" ...` (a stale global npm 9 shadows npm 11 here).
