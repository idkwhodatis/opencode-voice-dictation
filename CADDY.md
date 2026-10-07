# Chrome Android / server-injected edition

A separate **Caddy + Bun + SQLite** edition now lives in [`server/`](server/README.md). It works without a browser extension or an OpenCode fork, encrypts the speech-provider API key in SQLite with a separate private master key, and uses JSON for Bun startup configuration and exposes model/language/prompt and service-limit settings through a same-origin settings page and REST API.

See the [deployment guide](server/README.md), [stock Caddy example](server/Caddyfile), and [Bun user service](server/opencode-voice.service). The original Tampermonkey userscript and `dist/` artifacts are unchanged.
