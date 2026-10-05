# Server-injected edition: Caddy + Bun

Voice input in **any modern browser on any device**, without an extension, Tampermonkey, or an OpenCode fork. The existing userscript and its committed `dist/` remain unchanged. This is a separate distribution, version 0.3.0.

## Two ways to finish a recording

**Stop and review** (square) inserts an editable transcript at the saved cursor position in OpenCode's normal composer. Inspect it, modify it, delete it, or press OpenCode's Send button yourself. **Transcribe and send** (up arrow) inserts at the same saved position and sends the entire composer draft through OpenCode's verified native Send button, including any existing text and attachments.

Move the cursor or select ordinary text before or during recording; Stop/Send freezes the latest editor selection for the pending transcription. Selected plain text is replaced. Without a remembered cursor, text is appended. Mentions and attachments are preserved. If edits invalidate the saved position, the transcript is appended for review and never automatically sent. See [cursor and selection behavior](VOICE_ACTIONS.md#cursor-position-and-selected-text).

Stop, Ctrl+Space, and the recording-duration limit always leave a draft for review. Direct send is an explicit choice for that recording only; an old `autoSubmit: true` setting cannot override Stop. If Send is unavailable or you change the draft, the text stays for manual review. See [recording actions, safety behavior, and upgrade notes](VOICE_ACTIONS.md).

Bun serves the injected browser bundle, proxies transcription requests, reads the provider key from a private local file, and persists non-secret settings using built-in `bun:sqlite`. There are **no runtime npm dependencies and no Node server**. Keep the full repository checkout: the browser build reuses the existing `src/audio.ts`, `src/insert.ts`, `src/ui.ts`, and keyboard code. The injected edition adds cursor tracking in `server/caret.ts`; the userscript's append-only behavior is unchanged.

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

## 1. Configure Bun and the secret file

Requires Bun 1.3 or newer on a supported platform; CI uses Bun 1.4.2. The normal deployment does not need `npm install`, `bun install`, or a separate frontend build: Bun builds the browser bundle in memory at startup.

```sh
cd ~/repos/opencode-voice-dictation
git pull --ff-only
install -d -m 700 ~/.config/opencode-voice ~/.local/state/opencode-voice
cp server/.env.example ~/.config/opencode-voice/voice.env
chmod 600 ~/.config/opencode-voice/voice.env
```

Create `~/.config/opencode-voice/groq.key` with just your API key, then set its permissions to `600`. For example, using Bash without placing the key in shell history:

```bash
umask 077
read -r -s -p 'Groq API key: ' GROQ_KEY
printf '\n'
printf '%s' "$GROQ_KEY" > ~/.config/opencode-voice/groq.key
unset GROQ_KEY
chmod 600 ~/.config/opencode-voice/groq.key
```

Edit `voice.env`. In particular:

| Variable | Meaning |
| --- | --- |
| `VOICE_PUBLIC_ORIGIN` | The exact external origin, e.g. `https://opencode.example.com`, with no trailing slash or path. |
| `GROQ_API_KEY_FILE` | Absolute path to the key file. The file is reread for each request, so key rotation needs no restart. |
| `VOICE_PROXY_TOKEN` | A random token shared by Caddy and Bun. Generate with `openssl rand -hex 32`. Do not use the example placeholder. |
| `VOICE_DB_PATH` | SQLite settings file; defaults to `~/.local/state/opencode-voice/settings.sqlite`. |
| `VOICE_HOST` | Bind address; defaults to `127.0.0.1`. Set `0.0.0.0` when the reverse proxy runs in a container and reaches the host through a LAN address. The proxy token remains required. |
| `OPENCODE_UPSTREAM` | Your OpenCode server origin; defaults to `http://127.0.0.1:4096`. |
| `VOICE_STT_ENDPOINT` | Full transcription endpoint; defaults to Groq. HTTPS is required except for an explicitly configured loopback HTTP provider. |

`VOICE_PROXY_TOKEN_FILE` can replace `VOICE_PROXY_TOKEN` for Bun, including a systemd credential path. Caddy still needs the same raw token in its own environment. The provider API key is **not** this proxy token.

Groq is the default, but another compatible multipart transcription endpoint can be configured on the server. Endpoint changes require a service restart. Provider redirects are not followed with the key. The REST API intentionally cannot change the endpoint, credential path, or key: otherwise an authenticated browser could redirect the secret to another host.

## 2. Start the user service

```sh
install -d ~/.config/systemd/user
cp server/opencode-voice.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now opencode-voice
journalctl --user -u opencode-voice -n 30 --no-pager
```

The service file assumes the checkout is at `~/repos/opencode-voice-dictation` and Bun is `~/.bun/bin/bun`; adjust those two paths when necessary. It reads `~/.config/opencode-voice/voice.env`. Bun binds to `127.0.0.1:4097` by default; do not expose this port publicly. For unattended user services, enable user lingering if it is not already configured. Ordering after `opencode-server.service` does not make Bun depend on an OpenCode-specific installation layout.

For a foreground run instead, copy the example to `server/.env`, edit it, and run `cd server && bun run start`. `.env`, databases, and local secret/build directories are gitignored. Never commit real credentials.

## 3. Merge the Caddy routes

Merge the handlers from `server/Caddyfile` into your existing OpenCode site. **Do not overwrite your entire Caddyfile or remove your existing TLS/authentication setup.** The supplied full-site example uses Caddy `basic_auth`; an existing OIDC/forward-auth setup may be retained instead.

The sample expects the following variables in **Caddy's environment**, not just Bun's environment:

```text
VOICE_SITE=opencode.example.com
VOICE_PROXY_TOKEN=<same random token as Bun>
VOICE_AUTH_HASH=<hash generated by caddy hash-password>
```

The example Basic-auth username is `opencode`. Run `caddy hash-password` interactively to generate the password hash. If using systemd, put these values in a root-readable environment file such as `/etc/caddy/voice.env` (`chmod 600`) and reference it from a Caddy service drop-in:

```ini
[Service]
EnvironmentFile=/etc/caddy/voice.env
```

After adding/changing a drop-in, run `sudo systemctl daemon-reload`. Validate the adapted Caddyfile with those variables available to the validating process, then reload/restart Caddy according to your existing deployment. Caddy's `{$...}` substitutions happen when the configuration is adapted; configuring only the Bun service's environment is insufficient.

Authentication must cover **all `/voice/*` routes**, not just OpenCode. The proxy token is an additional Caddy-to-Bun check, not a substitute for user authentication: if Caddy accepts an anonymous caller and adds the token, that caller could use your paid transcription quota. Caddy overwrites `X-OCVD-Proxy-Token` rather than trusting a browser-supplied header.

If OpenCode has its own Basic authentication, forward its required Authorization header consistently on both the normal route and the HTML-injector route. The injector preserves incoming Authorization/Cookie headers only when calling the configured OpenCode upstream; they are never sent to the speech provider.

The examples reserve `/voice` at the origin root. `PUBLIC_ORIGIN` is not a subpath setting. With the optional replacement-module configuration, do not also route HTML through the Bun injector: select one injection method. The optional module matches a normal lowercase `</head>`; the stock Bun injector also handles other HTML casing and documents without a head.

## 4. Open it in any modern browser

Open the usual OpenCode HTTPS address in any modern browser. The microphone appears beside the composer controls, with a settings gear linking to `/voice/`. Because the injected code is served as part of the site, no userscript or browser extension is required. The browser/device must support the standard microphone/media APIs used by the app and must trust the site's certificate. Plain LAN HTTP is not suitable for microphone access.

Place the cursor where you want the text, then tap the microphone to record. While recording, choose the square **Stop and review** button or the up-arrow **Transcribe and send** button. Both use the latest saved editor selection at the moment recording stops. The settings gear is hidden while recording to leave room for the send action. Question inputs only offer review. The adapters handle both supported V2/beta composer dialects, question textareas, cursor-aware insertion, and verified Send-button checks. Recording, pending permission requests, and transcription are cancelled on session/input changes, cancellation, or page exit. Ctrl+Space remains available on desktop and always stops for review. Disable the userscript on this origin when using the injected edition; the shared initialization marker prevents two active instances, but the first one loaded would otherwise win.

Upstream CSP is preserved, not disabled. A restrictive policy must permit the same-origin voice script/fetches and the shared UI's dynamic styles. A nonce-only policy may need an explicit integration adjustment. Also check that no proxy-level `Permissions-Policy` disables the microphone. A PWA with stale cached HTML may need a full reload; the injector serves modified HTML with `Cache-Control: no-store`.

## REST API

All examples below run **locally on the server**. Set `VOICE_PROXY_TOKEN` in your shell to the configured token first. Remote callers use the authenticated HTTPS origin instead; Caddy adds the proxy token internally. Browser mutations also require `X-OCVD-Request: 1`; cross-origin API requests are rejected and CORS is not enabled.

```sh
# Read settings and readiness (never the API key).
curl -fsS http://127.0.0.1:4097/voice/config \
  -H "X-OCVD-Proxy-Token: $VOICE_PROXY_TOKEN"

# Persist a partial update immediately, without restarting the service.
curl -fsS -X PATCH http://127.0.0.1:4097/voice/config \
  -H "X-OCVD-Proxy-Token: $VOICE_PROXY_TOKEN" \
  -H 'X-OCVD-Request: 1' -H 'Content-Type: application/json' \
  -d '{"model":"whisper-large-v3","language":"","whisperPrompt":"OpenCode, Bun","temperature":0}'

# Send raw recorded audio; the Bun backend creates the provider's multipart form.
curl -fsS http://127.0.0.1:4097/voice/transcribe \
  -H "X-OCVD-Proxy-Token: $VOICE_PROXY_TOKEN" \
  -H 'X-OCVD-Request: 1' -H 'Content-Type: audio/webm' \
  --data-binary @recording.webm
```

`GET /voice/config` returns `{settings, apiKeyConfigured, maxAudioBytes, maxRecordingSeconds}`. `PATCH /voice/config` accepts only `model`, `language`, `whisperPrompt`, `temperature`, and the legacy `autoSubmit` field. `POST /voice/transcribe` retains `{text, autoSubmit}` for backward compatibility. **The injected browser client ignores `autoSubmit`; delivery is chosen with the recording buttons.** No database migration is required. The model is a validated ID, not a hard-coded two-model whitelist, to support compatible providers. Empty language means automatic detection. Unknown fields and invalid types are rejected atomically; settings are shared across devices, not per-user. Concurrent writes to the same field are last-writer-wins.

## Limits and storage

Defaults: 20 MiB per recording, a 300-second **browser recording limit**, two in-flight transcriptions, ten transcription attempts per minute across the installation, a 30-second upload deadline, and a 60-second provider timeout. These are adjustable via `voice.env`; provider limits still apply. The duration cap is a browser UX limit, not server-side audio-duration inspection. Byte/concurrency/rate limits are enforced by the backend. In-memory rate counters reset on restart.

API keys stay in the private file; SQLite stores **only non-secret settings**. The service sets a restrictive umask and creates the database with `0600` permissions. Protect the containing directory and SQLite WAL/SHM files as well. Recordings and transcripts are not persisted or logged by this service, but are sent to the configured speech provider; that provider's retention policy still applies. Back up SQLite using a consistent database backup or stop the service first.

## Development and verification

```sh
# Native Bun service/SQLite/security tests; no dependency installation needed.
cd server
bun test service.test.ts

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
