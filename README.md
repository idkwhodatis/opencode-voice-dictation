# 🚀 OpenCode WebUI Voice Input

Voice input for OpenCode WebUI is available through **two supported installation paths**:

| Path | Best for | How it works |
| --- | --- | --- |
| **A. Tampermonkey userscript** | Desktop browsers and browsers that support userscripts/extensions | Injects the mic controls in the browser. Your STT settings/API key live in userscript storage. **[Install the userscript](https://raw.githubusercontent.com/idkwhodatis/opencode-webui-voice-input/master/dist/opencode-voice-dictation.user.js)** |
| **B. Server-side injection (Caddy + Bun + SQLite)** | **Any modern browser on any device**, especially when userscripts/extensions are unavailable | Caddy/Bun injects the same voice UI into OpenCode. The provider API key is encrypted in SQLite with a separate private master key; provider/model/language settings are managed in the web page. **[Server deployment guide](server/README.md)** |

**Choose one path for a given OpenCode origin.** Do not intentionally run both at the same time.

![Cover](assets/cover.png)
<!-- tagline-en:start -->
> Voice dictation for OpenCode web — mic button via Whisper (Groq API)
<!-- tagline-en:end -->

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh-CN.md)

---

<!-- summary-en:start -->
### ❓ Why
Needed a way to dictate to agents from a phone. Stock Android voice input doesn't cut it. OpenCode web had no built-in voice.

### ✅ What
Two deployment modes for the same OpenCode WebUI voice workflow:

- **Tampermonkey/Violentmonkey userscript** — quickest setup where userscripts are supported.
- **Server-side injection with Caddy + Bun + SQLite** — browser/device independent for self-hosted OpenCode behind a reverse proxy. It works in any modern browser with standard microphone/media APIs, without installing a userscript or extension. The speech-provider key remains on the server.
<!-- summary-en:end -->

<!-- features-en:start -->
### Features

| Feature | Description |
|---------|-------------|
| 🎤 Mic button | Beside Send, with matching native size and default cursor; click to dictate |
| 🌍 Language | `ru`, `en`, or auto-detect |
| ⚡ Auto-submit | Sends transcription to the agent after dictation (toggleable) |
| 🧠 Whisper (Groq) | `whisper-large-v3` / `whisper-large-v3-turbo` via Groq API |
| 🌐 Browser support | Tampermonkey requires userscript support; server-side injection works in any modern browser/device with standard microphone/media APIs |
| ✅ Current V2 contract | Stable and renamed beta composer: source-verified at `907b3bc` / `e5ecb571`; mocked Chromium tests |
| 🔄 Auto-update | Updates itself via `@updateURL` — no manual reinstall |
| ⌨️ Ctrl+Space | Desktop hotkey to start/stop recording |
<!-- features-en:end -->

### ⚡ Path A — Tampermonkey Quick Start

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Get a key at [console.groq.com/keys](https://console.groq.com/keys)
3. Open the [script install link](https://raw.githubusercontent.com/idkwhodatis/opencode-webui-voice-input/master/dist/opencode-voice-dictation.user.js) — it installs into Tampermonkey
4. **Important: scope the script before use.** Tampermonkey Dashboard → this script → **Settings** → **Includes/Excludes** → **User matches** → **Add**. Add only your own OpenCode URL pattern, such as `https://opencode.example.com/*`, then **Save** and reload OpenCode. Use your deployment’s real scheme, dedicated host and path prefix. If needed, change the dashboard Config mode to Advanced to see the controls.
5. The shipped match is the reserved, non-resolving `https://opencode.invalid/*`. It intentionally runs on no real site until you add your URL. Do not replace it with `*://*/*`, a generic localhost rule, or an all-sites User include. If upgrading, remove old broad User matches/includes and disable the separately installed upstream script.
6. On the scoped OpenCode page, Tampermonkey menu → **Set Groq API Key**. Enter your own key there, never in this repository. An empty value clears it. **Set Whisper Model**, **Set Language** (empty = automatic, e.g. `zh`), and **Toggle Auto-Submit** use userscript storage and survive refresh/updates.
7. Auto-submit is **OFF by default**. Click the mic or Ctrl+Space to start/stop; Cancel discards pending dictation. Stopping sends your recording to Groq (or your configured proxy) using your key and may incur Groq charges. Review the appended text before Send. Navigating to another session or replacing the editor cancels the operation.

**Port-specific localhost:** Tampermonkey match rules ignore ports. Do **not** rely on a `localhost:4096` User match to isolate that port. Leave User matches at the inert default and add `/^http:\/\/localhost:4096\/.*$/` under **User includes** instead (change the port to yours). Remove any broader localhost User includes/matches. This anchored expression matches only that scheme, host and port. [Official port-matching notes](https://www.tampermonkey.net/changelog.php?locale=en&more=true&show=gcal).

Microphone access requires HTTPS or localhost and browser permission. The script requests it only when you start recording. The V2 editor preserves existing text, mention nodes and attachments. The generic home screen and disabled child-session composer have no mic until an editable composer appears. [Tampermonkey scope instructions](https://www.tampermonkey.net/faq.php?locale=en#Q103).

### 🖥️ Path B — Server-side injection (Caddy + Bun + SQLite)

Use this path when OpenCode is self-hosted behind Caddy and you want voice input to work **across modern browsers and devices without installing anything client-side**.

The server edition:

- injects the voice UI into OpenCode without forking OpenCode;
- runs a small **Bun** service on the server;
- stores the speech-provider API key encrypted in SQLite, with a separate private master key and write-only web settings;
- persists model, language, Whisper prompt, temperature, and auto-submit settings in **SQLite**;
- exposes a same-origin `/voice/` settings page and REST API;
- keeps OpenCode streaming/WebSocket traffic going directly to OpenCode.

Start with **[server/README.md](server/README.md)**. Example Caddy configuration, systemd service, environment settings, SQLite behavior, security notes, and REST API examples are all documented there.

> If you deploy Path B on an origin where the Tampermonkey version was already installed, disable the userscript for that origin.

### 🌐 Custom STT Endpoint

Groq may block direct requests from some networks. Point the script at your own nginx proxy:

1. Deploy an nginx reverse proxy that forwards to `api.groq.com`:
   ```nginx
   location / {
       proxy_pass https://api.groq.com:443;
       proxy_set_header Host api.groq.com;
   }
   ```
2. Tampermonkey menu → **Set STT Endpoint** → paste `https://your-domain.com/openai/v1/audio/transcriptions`
3. Requests now go through your trusted HTTPS proxy, which receives both your recording and API key. The menu asks you to confirm that destination. `@connect *` preserves custom proxy support; it does **not** enable the script on all websites. Page execution remains limited by User matches.

A path prefix is not needed if the domain is dedicated to Groq. The `/groq` variant stays valid for multi-proxy domains — `location /groq/` with a trailing slash strips the prefix.

### 🌡️ Temperature

Whisper may hallucinate on silence/noise. **Set Temperature** (default `0` = deterministic, range `0`–`1`) reduces hallucinations.

### 🌐 Wrong Language (English instead of Russian)

If the model returns English text for Russian audio, clear the Whisper Prompt:

1. Open Tampermonkey/Violentmonkey menu → **Set Whisper Prompt**
2. Leave the field empty (delete all text)
3. Confirm

The prompt biases the model toward the prompt's language. An English prompt with Russian audio causes the model to output English. The prompt should match the audio language (or be empty for auto-detect).

---

---

## 💬 Support and contacts

👉 **[slaid098.dev/support](https://slaid098.dev/support)**

## Development and verification

```sh
npm ci
npx playwright install chromium
npm run check
```

For a system Chromium, use `CHROMIUM_PATH=/path/to/chromium npm run check`. The aggregate command runs lint, types, dead-code checks, Vitest with coverage, a reproducible userscript build and Chromium tests. CI targets `master` and verifies that committed `dist/` matches source. GitHub forks may require the owner to enable Actions once under the repository's Actions tab.

Covered: native action-row placement and sizing at desktop/narrow widths, tooltip/Submit replacement, lazy/initial composer, new/replaced/switching sessions, duplicate injection, start/stop/cancel (including pending microphone permission and HTTP requests), denied microphone, resource cleanup, HTTP 401/429/5xx, network/timeout, rich-text append and input events, optional Send/Stop guards, pagehide/refresh cleanup, persisted configuration, and inert metadata/unrelated DOM.

Boundary: browser tests use the built script and a source-shaped V2 fixture, with mocked microphone and Groq. No real recording, API key, paid API call, extension installation, live server, Firefox/mobile, or actual Tampermonkey User-match enforcement was exercised. After installing, check the script is absent on an unrelated site, appears on your scoped OpenCode URL, and persists settings after reload. Keep auto-submit off for your first test.

[Source details and decisions](docs/decisions/0008-scoped-v2-dictation.md), [renamed beta composer support](docs/decisions/0009-renamed-beta-composer.md). Original project by [slaid098](https://github.com/slaid098/opencode-voice-dictation); this fork's userscript install/update files and server-side edition are maintained in `idkwhodatis/opencode-webui-voice-input`.
