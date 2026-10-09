# Chrome Android / server-injected edition

A separate **Caddy + Bun + SQLite** edition lives in [`server/`](server/README.md). It works without a browser extension, encrypts the speech-provider API key in SQLite with a separate private master key, and exposes provider, transcription, and service-limit settings on an authenticated same-origin page.

Startup JSON supports an explicit public `basePath` (default `/`) and `proxyMode` (`preserve` or `strip`, default `preserve`). All plugin URLs, including the no-op worker, live under `<basePath>voice/`: for `/tools/opencode/`, settings are `/tools/opencode/voice/` and the worker is `/tools/opencode/voice/sw.js`, scoped to `/tools/opencode/`. The plugin does not rewrite OpenCode's own assets, API URLs, or routing; a nested OpenCode deployment must already support its prefix or have a separately configured adaptation.

See the [deployment guide](server/README.md), [nested proxy examples](server/README.md#nested-installations), [service-worker migration notes](server/README.md#service-worker-scope-and-existing-installations), [stock root Caddy example](server/Caddyfile), and [Bun user service](server/opencode-voice.service). No permanent `/sw.js` replacement or origin-root plugin aliases are needed for nested installations. Existing clients controlled by a cached OpenCode worker may need the documented one-time, application-specific recovery before they can receive the injected bootstrap.

The original Tampermonkey userscript and `dist/` artifacts are unchanged.
