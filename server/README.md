# Server-injected edition: Caddy + Bun

Voice input in **any modern browser on any device**, without an extension, Tampermonkey, or an OpenCode fork. The existing userscript and its committed `dist/` remain unchanged. This is a separate distribution, version 0.5.0.

## Two ways to finish a recording

**Stop and review** (square) inserts an editable transcript at the saved cursor position in OpenCode's normal composer. Inspect it, modify it, delete it, or press OpenCode's Send button yourself. **Transcribe and send** (up arrow) inserts at the same saved position and sends the entire composer draft through OpenCode's verified native Send button, including any existing text and attachments.

Move the cursor or select ordinary text before or during recording; Stop/Send freezes the latest editor selection for the pending transcription. Selected plain text is replaced. Without a remembered cursor, text is appended. Mentions and attachments are preserved. If edits invalidate the saved position, the transcript is appended for review and never automatically sent. See [cursor and selection behavior](VOICE_ACTIONS.md#cursor-position-and-selected-text).

Stop, Ctrl+Space, and the recording-duration limit always leave a draft for review. Direct send is an explicit choice for that recording only; an old `autoSubmit: true` setting cannot override Stop. If Send is unavailable or you change the draft, the text stays for manual review. See [recording actions, safety behavior, and upgrade notes](VOICE_ACTIONS.md).

Bun serves the injected browser bundle, proxies transcription requests, stores the provider key with authenticated AES-256-GCM encryption in built-in `bun:sqlite`, and persists transcription preferences there too. There are **no runtime npm dependencies and no Node server**. Keep the full repository checkout: the browser build reuses the existing `src/audio.ts`, `src/insert.ts`, `src/ui.ts`, and keyboard code. The injected edition adds cursor tracking in `server/caret.ts`; the userscript's append-only behavior is unchanged.

## Traffic layout

```text
Modern browser/device → authenticated HTTPS Caddy
  /voice/voice.js     → Bun :4097 (browser bundle)
  /voice/            → Bun :4097 (mobile-friendly settings page)
  /voice/config      → Bun :4097 (GET / PATCH → SQLite)
  /voice/transcribe  → Bun :4097 (audio → provider → transcript)
  /sw.js             → the repo's no-op worker (replaces OpenCode's PWA worker)
  HTML navigations   → Bun :4097 → OpenCode :4096 (HTML injection only)
  everything else    → OpenCode :4096 directly (including streams/WebSockets)
```

**Stock Caddy cannot perform arbitrary response-body replacement by itself.** The supplied `Caddyfile` uses the already-needed Bun service to inject a script into HTML navigation responses. No custom Caddy build is required. `Caddyfile.replace` is an alternative for installations that already use the `github.com/caddyserver/replace-response` module; in that variant Caddy itself performs the replacement and Bun handles only `/voice/*`.

The injector uses an HTML parser, preserves upstream CSP and authentication headers, avoids compressed-body replacement, and removes stale validators/lengths from modified HTML. It does not fork, rebuild, or write into OpenCode. Its browser script still depends on OpenCode's composer DOM, so upstream UI changes can require updating this repository's shared adapters.

OpenCode's own Workbox service worker must not stay in control. It serves the cached app shell for every in-scope navigation, and its denylist covers `/api`, `/auth` and asset prefixes but not `/voice` — so it hides both the injected microphone and the settings page, no matter what headers the injector sends. The sample therefore serves the repository's [`sw.js`](sw.js) for `GET /sw.js`; on its next update check the browser replaces the old worker with this no-op one, after which every request reaches the network. Adjust the handler's `root` to your checkout and keep it on the OpenCode origin.

## 1. Configure Bun with JSON

Requires Bun 1.3 or newer on a supported platform; CI uses Bun 1.4.2. No runtime npm dependencies or separate frontend build are required. **New installations need no application or Caddy environment variables.** Bun startup settings live in JSON; Caddy has its own Caddyfile; live preferences and encrypted provider credentials live in SQLite.

```sh
cd ~/repos/opencode-webui-voice-input
git pull --ff-only
install -d -m 700 ~/.config/opencode-voice ~/.local/state/opencode-voice
cp server/config.example.json ~/.config/opencode-voice/config.json
chmod 600 ~/.config/opencode-voice/config.json
# New installation only: do not replace an existing shared token.
umask 077
openssl rand -hex 32 | tr -d '\n' > ~/.config/opencode-voice/proxy.token
```

Edit [config.example.json](config.example.json)'s copied values for your installation. The shared proxy token is a private file; do not put its contents, provider API keys, or the master encryption key in JSON. Existing installations should preserve their current token and paths instead of running the token-generation command.

| JSON field | Default / meaning |
| --- | --- |
| `publicOrigin` | Required exact browser-facing HTTPS origin, including any nonstandard port; no trailing slash/path. HTTP only for loopback development. |
| `host` | `127.0.0.1`; change only if containerized Caddy requires another bind address. |
| `port` | `4097`, the **Bun backend** port, not necessarily Caddy's public port. |
| `upstream` | `http://127.0.0.1:4096`, your OpenCode origin. |
| `databasePath` | `~/.local/state/opencode-voice/settings.sqlite`; preserve your existing database path. |
| `encryptionKeyFile` | `~/.config/opencode-voice/encryption.key`; preserve the matching master key for existing encrypted credentials. Generated privately on first provider save for new installations. |
| `proxyTokenFile` | `~/.config/opencode-voice/proxy.token`; the same token Caddy reads, at least 32 characters. |
| `legacyProvider` | Optional `{ "apiKeyFile": "/existing/groq.key", "endpoint": "https://api.groq.com/openai/v1/audio/transcriptions" }`; fallback only before the first explicit provider save. |

The default configuration file is `~/.config/opencode-voice/config.json`. Select another with `--config /absolute/path/config.json` or `--config=/absolute/path/config.json`. Relative paths **inside JSON** resolve against that file's directory; `~/` expands to the service user's home. Omitted storage/key paths keep the established absolute home-directory defaults, not the configuration directory. Relative CLI config paths resolve against the launch directory. Invalid JSON, unknown fields, invalid types/ranges, or an explicitly selected missing file stop startup with a redacted error. Only the path is a CLI option; settings are not scattered among override flags.

For example, if Caddy is public HTTPS port **4097** and Bun is **4098**, set `publicOrigin` to the exact HTTPS origin with `:4097`, and `port` to `4098`. Keep the existing bind address, upstream and storage paths, and point Caddy's voice routes at port 4098. Do not copy default ports over a working deployment.

### Live settings, without restarting

Open authenticated **/voice/** to choose Groq or Custom, enter an encrypted API key, and edit the model, language, prompt, temperature, or Service limits:

| Live setting | Default | Allowed range |
| --- | --- | --- |
| Maximum audio size | 20 MiB | 1–100 MiB |
| Maximum recording duration | 300 seconds | 1–3600 seconds |
| Provider timeout | 60 seconds | 1–300 seconds |
| Concurrent transcriptions | 2 | 1–16 |
| Transcription starts per minute | 10 | 1–1000 |

All limits are integers. Partial saves preserve unrelated changes from another device. Each accepted request snapshots its preferences and limits; changes do not abort in-flight work. Lower concurrency prevents new work until capacity is available; changing the rate limit does not reset the recent-start history. The recording browser fetches its limits for each recording. A recording already in progress keeps its browser timer; its later upload is checked against the server's then-current admission limits.

Bun has a fixed 100 MiB transport ceiling, while the lower saved audio limit is enforced during streamed reads. Upload/read safety deadlines remain fixed. Startup JSON intentionally rejects these live-limit fields: use the Settings page instead.

Custom uses a full OpenAI-compatible multipart transcription URL and a free-text model ID, not a provider registry. HTTPS is recommended. HTTP is permitted only for literal loopback/private LAN IPs and carries recordings and credentials in plaintext. URL credentials, queries and fragments are rejected; redirects never forward the key. Changing provider/endpoint requires a newly entered key. The saved key is never returned to the page; its entry field clears after successful save or cancellation. Saving does not verify provider connectivity or quota.

All web settings are shared by this server instance. Anyone authorized by Caddy can change its provider and limits. Keep authentication enabled and do not expose Bun directly; its proxy-token, origin and mutation-marker checks remain required.

### Migrating an existing environment-based installation

1. Keep the current deployment working while preparing JSON. Record its exact origin, Bun port/bind address, upstream, database and encryption-key paths. Stage these in a file named `config.pending.json` while migrating, so default JSON discovery does not conflict with the still-running legacy setup; no database or master-key migration is needed.
2. Preserve the existing Caddy/Bun shared token in a private file. Point JSON and Caddy at that same value; paths can differ across container mounts. Do not generate a replacement unless deliberately rotating both sides.
3. If still using the legacy plaintext provider file, describe it with `legacyProvider` until you explicitly save an encrypted key in the page. Existing encrypted credentials retain precedence. Removing a saved key never reactivates the old file; historical plaintext files/backups are not automatically deleted.
4. Transfer any custom service limits to the Settings page. Starting once in legacy mode seeds missing SQLite limit fields from the previous environment values. Already-saved fields always win on subsequent starts, so later web changes survive restarts.
5. Remove legacy app variables from the service environment and any Bun-loaded `.env` files before enabling JSON. Rename the staged JSON to `config.json` and replace the old systemd `EnvironmentFile` startup with the new `--config` example, retaining your actual executable/repository paths. Validate and restart using your normal deployment process.

Compatibility is explicit: if the default JSON file is absent and legacy origin/token variables are present, the old environment configuration still starts with a warning. In that mode relative paths retain their previous launch-directory meaning. If JSON exists or `--config` is supplied, **any supported legacy app variable causes a clear conflict error, even when values match**. Nothing silently overrides JSON or changes paths. A missing explicit config never falls back. Existing `VOICE_PROXY_TOKEN_FILE` takes precedence over `VOICE_PROXY_TOKEN` in legacy mode, with a warning when both are set. [The old environment example](.env.example) remains for migration only.

## 2. Start the user service

```sh
install -d ~/.config/systemd/user
cp server/opencode-voice.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now opencode-voice
journalctl --user -u opencode-voice -n 30 --no-pager
```

The service file assumes the checkout is `~/repos/opencode-webui-voice-input` and Bun is `~/.bun/bin/bun`; adjust both as necessary. It starts with `--config ~/.config/opencode-voice/config.json` (systemd expands `%h` in the actual unit), and no `EnvironmentFile`. Bun listens on loopback port 4097 by default; do not expose it publicly. User lingering may be needed for unattended services. Ordering after `opencode-server.service` does not require a particular OpenCode installation layout.

For a foreground run: `cd server && bun run main.ts --config ~/.config/opencode-voice/config.json`. Configuration files named `config.json`, `.env`, databases and secret/build directories are gitignored. Never commit credentials.

## 3. Merge the Caddy routes

Merge handlers from [Caddyfile](Caddyfile) into your **existing** OpenCode site. Do not overwrite the entire configuration or remove TLS/authentication. The example uses Basic authentication; retain existing OIDC/forward-auth if appropriate.

No Caddy environment variables are required by the new examples. Edit the literal site address, backend ports, checkout root, and token-file path. Replace `REPLACE_WITH_BCRYPT_HASH` with a hash generated interactively by `caddy hash-password`; the example username is `opencode`. The placeholder intentionally is not a valid installed password configuration.

Both voice reverse-proxy handlers use `header_up X-OCVD-Proxy-Token {file./path/to/opencode-voice/proxy.token}`. Point this at the private token file readable by Caddy. Its contents must match Bun's `proxyTokenFile` exactly, without a trailing newline; the setup command above generates this format. Share only that file with Caddy, not the master encryption key or the database. For containers, use an appropriately permissioned read-only mount and the path **inside Caddy's container**; Bun may use a different host path for the same contents. Grant only the service accounts the needed read access. Caddy's secret-file placeholders are documented in its [configuration concepts](https://caddyserver.com/docs/caddyfile/concepts#environment-variables).

Run `caddy validate --config /your/Caddyfile --adapter caddyfile`, then reload/restart through your existing deployment. CI validates the stock example and exercises actual Basic authentication, file-backed token forwarding, client-token overwrite and missing-file failure with dummy credentials. Older installed Caddy versions must be checked for file-placeholder support before migrating; keep the working old configuration until validation succeeds.

Authentication must cover **all `/voice/*` routes**, not just OpenCode. The proxy token is an additional Caddy-to-Bun check, not a substitute for user authentication: if Caddy accepts an anonymous caller and adds the token, that caller could use your paid transcription quota. Caddy overwrites `X-OCVD-Proxy-Token` rather than trusting a browser-supplied header.

If OpenCode has its own Basic authentication, forward its required Authorization header consistently on both the normal route and the HTML-injector route. The injector preserves incoming Authorization/Cookie headers only when calling the configured OpenCode upstream; they are never sent to the speech provider.

The examples reserve `/voice` at the origin root. `publicOrigin` is not a subpath setting. With the optional replacement-module configuration, do not also route HTML through the Bun injector: select one injection method. The optional module matches a normal lowercase `</head>`; the stock Bun injector also handles other HTML casing and documents without a head.

## 4. Open it in any modern browser

Open the usual OpenCode HTTPS address in any modern browser. The microphone appears beside the composer controls, with a settings gear linking to `/voice/`. Because the injected code is served as part of the site, no userscript or browser extension is required. The browser/device must support the standard microphone/media APIs used by the app and must trust the site's certificate. Plain LAN HTTP is not suitable for microphone access.

Place the cursor where you want the text, then tap the microphone to record. While recording, choose the square **Stop and review** button or the up-arrow **Transcribe and send** button. Both use the latest saved editor selection at the moment recording stops. The settings gear is hidden while recording to leave room for the send action. Question inputs only offer review. The adapters handle both supported V2/beta composer dialects, question textareas, cursor-aware insertion, and verified Send-button checks. Recording, pending permission requests, and transcription are cancelled on session/input changes, cancellation, or page exit. Ctrl+Space remains available on desktop and always stops for review. Disable the userscript on this origin when using the injected edition; the shared initialization marker prevents two active instances, but the first one loaded would otherwise win.

Upstream CSP is preserved, not disabled. A restrictive policy must permit the same-origin voice script/fetches and the shared UI's dynamic styles. A nonce-only policy may need an explicit integration adjustment. Also check that no proxy-level `Permissions-Policy` disables the microphone. A PWA with stale cached HTML may need a full reload; the injector serves modified HTML with `Cache-Control: no-store`.

## REST API

Use the authenticated HTTPS origin; Caddy supplies its internal token. For the sample Basic-auth setup, curl prompts for the user's password without putting it in the command line. Replace the example hostname with your actual origin. Keep provider-key entry in the web page.

```sh
curl --user opencode -fsS https://opencode.example.com/voice/config

curl --user opencode -fsS -X PATCH https://opencode.example.com/voice/config \
  -H 'X-OCVD-Request: 1' -H 'Content-Type: application/json' \
  -d '{"model":"whisper-large-v3","language":"","maxConcurrent":3,"requestsPerMinute":20}'
```

Browser mutations require `X-OCVD-Request: 1`; cross-origin API requests are rejected and CORS is not enabled. Direct loopback callers also require the proxy-token header, unlike callers through authenticated Caddy.

`GET /voice/config` returns `{settings, apiKeyConfigured, maxAudioBytes, maxRecordingSeconds}`. `PATCH /voice/config` accepts `model`, `language`, `whisperPrompt`, `temperature`, the five live limit fields above, and the legacy `autoSubmit` field. `POST /voice/transcribe` retains `{text, autoSubmit}` for backward compatibility. **The injected browser client ignores `autoSubmit`; delivery is chosen with the recording buttons.** Existing preference values are preserved. The model is a validated ID, not a hard-coded two-model whitelist, to support compatible providers. Empty language means automatic detection. Unknown fields and invalid types are rejected atomically; settings are shared across devices, not per-user. Concurrent writes to the same field are last-writer-wins.

## Limits and storage

Defaults: 20 MiB per recording, a 300-second **browser recording limit**, two in-flight transcriptions, ten transcription attempts per minute across the installation, a 30-second upload deadline, and a 60-second provider timeout. The five size/duration/concurrency/rate/provider-timeout limits are adjustable through the Settings page; the 30-second upload deadline is fixed. Provider limits still apply. The duration cap is a browser UX limit, not server-side audio-duration inspection. Byte/concurrency/rate limits are enforced by the backend. In-memory rate counters reset on restart.

SQLite stores provider metadata and an AES-256-GCM encrypted key, with a fresh random nonce on each key write and the provider/endpoint bound as authenticated data. `GET /voice/provider` returns only status and non-secret provider metadata; authenticated `PUT /voice/provider` explicitly changes the provider/key. Omit `apiKey` to preserve a key for an unchanged target; `apiKey: null` removes it. Unknown fields are rejected. General preference reads/exports do not include ciphertext or keys.

The master encryption key is a separate private `0600` file, not a value inside SQLite. Encryption protects a database-only leak; an attacker who obtains both files or controls the running server can decrypt the credential. The plaintext API key exists transiently in the browser while you enter it, in HTTPS transit, and in server memory when used for authentication; it is not returned to the browser or written to plaintext storage by the new flow. JavaScript, operating-system swap and crash dumps do not provide a guarantee of perfect memory zeroization. Avoid request-body/header logging at your proxy or debugging layers.

Back up the database consistently and back up the master key separately with restricted access. Restoring SQLite without its matching master key cannot recover the stored API key. Missing, malformed, inaccessible, or wrong keys and corrupt ciphertext fail closed; the service does not silently fall back to a legacy credential. Restore the matching key from a trusted backup. If recovery is impossible, explicitly **Remove key** before adding a replacement; this abandons the old encrypted credential. A missing master key may then be generated again, but an insecure or malformed existing key file must first be repaired by the server owner. Credential rotation uses **Change key**; replacing the master-key file is not a supported rotation mechanism and makes existing ciphertext unreadable. Keep the matching master key until all backups encrypted with it are retired. Removing a credential deletes the active encrypted value but cannot erase historical database/WAL/backups; revoke an old provider key when needed.

The service sets a restrictive umask and creates the database with `0600` permissions. Protect the containing directory and SQLite WAL/SHM files as well. Recordings and transcripts are not persisted or logged by this service, but are sent to the configured speech provider; that provider's retention policy still applies. Back up SQLite using a consistent database backup or stop the service first.

## Development and verification

```sh
# Native Bun service/SQLite/security tests; no dependency installation needed.
cd server
bun test service.test.ts provider.test.ts config.test.ts main.test.ts

# Optional development-only type definitions and TypeScript checker.
bun install
bun run typecheck

# From repository root, using the existing browser-test tooling.
npm ci
npx playwright install chromium
npx playwright test --config server/playwright.config.ts
```

The dedicated read-only `Bun voice server` workflow runs native Bun tests, strict type checking, mobile-viewport Chromium tests with synthetic audio, the existing userscript suite/build, and stock Caddy configuration validation. Browser regressions cover review/edit/delete, native input-event activation, delayed Send readiness, both composer dialects, duplicate clicks, unavailable/Stop/shell buttons, edits during transcription, cancellation, session switches, empty/error results, recording limits, questions, and settings persistence. Cursor regressions also cover start/middle/end insertion, selection replacement, focus loss, keyboard dictation, frozen positions, Chinese/Unicode, multiline text, mention/attachment preservation, text-node rerenders, and invalidated positions. Root Biome and Vitest coverage remain scoped away from this separate Bun distribution; the original userscript coverage thresholds are unchanged. No test calls a real paid speech API or uses your credentials. A real browser/device microphone and your existing Caddy installation still require a deployment smoke test.

Reference documentation: [Bun HTTP](https://bun.com/docs/runtime/http/server), [Bun SQLite](https://bun.com/docs/runtime/sqlite), [Groq speech-to-text](https://console.groq.com/docs/speech-to-text), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [optional replacement module](https://github.com/caddyserver/replace-response).
