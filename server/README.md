# Server-injected edition: Caddy + Bun

Voice input in **any modern browser on any device**, without an extension, Tampermonkey, or an OpenCode fork. The existing userscript and its committed `dist/` remain unchanged. This is a separate distribution, version 0.6.0.

## Two ways to finish a recording

**Stop and review** (square) inserts an editable transcript at the saved cursor position in OpenCode's normal composer. Inspect it, modify it, delete it, or press OpenCode's Send button yourself. **Transcribe and send** (up arrow) inserts at the same saved position and sends the entire composer draft through OpenCode's verified native Send button, including any existing text and attachments.

Move the cursor or select ordinary text before or during recording; Stop/Send freezes the latest editor selection for the pending transcription. Selected plain text is replaced. Without a remembered cursor, text is appended. Mentions and attachments are preserved. If edits invalidate the saved position, the transcript is appended for review and never automatically sent. See [cursor and selection behavior](VOICE_ACTIONS.md#cursor-position-and-selected-text).

Stop, Ctrl+Space, and the recording-duration limit always leave a draft for review. Direct send is an explicit choice for that recording only; an old `autoSubmit: true` setting cannot override Stop. If Send is unavailable or you change the draft, the text stays for manual review. See [recording actions, safety behavior, and upgrade notes](VOICE_ACTIONS.md).

Bun serves the injected browser bundle, proxies transcription requests, stores the provider key with authenticated AES-256-GCM encryption in built-in `bun:sqlite`, and persists transcription preferences there too. There are **no runtime npm dependencies and no Node server**. Keep the full repository checkout: the browser build reuses the existing `src/audio.ts`, `src/insert.ts`, `src/ui.ts`, and keyboard code. The injected edition adds cursor tracking in `server/caret.ts`; the userscript's append-only behavior is unchanged.

## Traffic layout

Every public plugin URL is under `<basePath>voice/`. With the default `basePath: "/"`:

```text
Modern browser/device → authenticated HTTPS Caddy
  /voice/voice.js     → Bun :4097 (blocking browser bootstrap + bundle)
  /voice/            → Bun :4097 (mobile-friendly settings page)
  /voice/settings.js → Bun :4097 (settings code)
  /voice/settings.css → Bun :4097 (settings styles)
  /voice/config      → Bun :4097 (GET / PATCH → SQLite)
  /voice/provider    → Bun :4097 (GET / PUT → encrypted provider settings)
  /voice/transcribe  → Bun :4097 (audio → provider → transcript)
  /voice/health      → Bun :4097 (health status)
  /voice/sw.js       → Bun :4097 (no-op worker; scope /)
  HTML navigations   → Bun :4097 → OpenCode :4096 (HTML injection only)
  everything else    → OpenCode :4096 directly (including streams/WebSockets)
```

For `basePath: "/tools/opencode/"`, every `/voice/…` URL above becomes `/tools/opencode/voice/…`; the worker scope becomes `/tools/opencode/`. The bare settings path redirects to the trailing-slash URL within that namespace. A subpath deployment does not expose origin-root `/voice/*` aliases or a plugin-owned sibling `/tools/opencode/sw.js`. The origin and mount path are separate configuration values.

**Stock Caddy cannot perform arbitrary response-body replacement by itself.** The supplied `Caddyfile` uses the already-needed Bun service to inject a script into HTML navigation responses. No custom Caddy build is required. `Caddyfile.replace` is an alternative for installations that already use the `github.com/caddyserver/replace-response` module; in that variant Caddy performs the replacement and Bun handles only the namespaced voice routes.

The injector uses an HTML parser, preserves upstream CSP and authentication headers, avoids compressed-body replacement, and removes stale validators/lengths from modified HTML. It puts a parser-blocking external script after existing meta CSP policies and before the first app script, so OpenCode cannot register its cached-shell worker first. A meta CSP occurring after a script causes injection to be skipped rather than bypassing that policy. Do not add `defer` or `async`, or move this script after OpenCode's scripts. It does not fork, rebuild, or write into OpenCode. Its browser script still depends on OpenCode's composer DOM, so upstream UI changes can require updating this repository's shared adapters.

### Service-worker scope and existing installations

OpenCode's Workbox worker can serve a cached app shell instead of the network HTML, hiding both the injected microphone and the voice settings page. Once the injected bootstrap runs, it registers `<basePath>voice/sw.js` with the **exact app scope `<basePath>`**, and redirects OpenCode's registration of its own exact `<basePath>sw.js` at that same scope to the namespaced no-op worker. A stock `/sw.js` registration call with scope `/`, made by this injected app, is also redirected into the configured app scope; an existing origin-root registration is not modified in a nested deployment. Other registration calls are left alone. If an unrelated worker already owns the exact app scope, the bootstrap refuses to replace it. The worker activates with `skipWaiting` and `clients.claim`, has no fetch handler, and never unregisters other workers. It only deletes the default Workbox precache name tied to its exact registration scope; custom/unknown names and sibling apps' caches are retained.

Bun serves the worker with `Service-Worker-Allowed: <basePath>` so it can control the app outside its own `voice/` directory, plus a non-cacheable response and JavaScript MIME type. Keep that response header through the proxy. The steady-state configuration has **no `/sw.js` replacement handler**. At the origin root, the same mechanism uses `/voice/sw.js` and scope `/`; on a shared origin, use a nested app scope rather than assigning this plugin control of sibling applications. See the [Service-Worker-Allowed reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Service-Worker-Allowed).

**An already-controlling cached shell is a bootstrap boundary:** if Workbox returns old HTML without the injected script, new server HTML and cache headers cannot reach that page. Installing this server is not enough to recover every previously installed PWA automatically. For affected clients, choose one of these one-time, app-specific migration paths:

1. In browser developer tools, identify the OpenCode registration by its exact scope and script URL. Unregister only that registration, close its controlled tabs/PWA windows, and reopen the app from the network. If necessary, use a service-worker bypass reload and remove only cache entries that you have verified belong to this OpenCode installation. Do not use origin-wide “clear site data”, unregister every worker, or delete all caches when the origin hosts other apps.
2. If the old worker URL belongs exclusively to this OpenCode installation, an operator can temporarily serve this repository's no-op worker at that **exact legacy script URL**, with the app's matching `Service-Worker-Allowed` scope and non-cacheable headers, through the existing authentication. On a browser update check it replaces the cached-shell worker, allowing the next network navigation to receive the new bootstrap. Verify migration in supported browsers and remove the temporary bridge after affected clients have migrated. This is a limited migration bridge, not a permanent sibling route; do not intercept a root worker owned by another app.

Verify the active script URL is `<basePath>voice/sw.js`, its scope is exactly `<basePath>`, the app receives freshly injected HTML, and sibling apps' registrations remain unchanged. If a legacy worker has an origin-wide scope shared with other applications, establish ownership and isolate the OpenCode deployment before modifying it; this plugin cannot safely infer which caches or registrations belong to other apps.

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
| `basePath` | `/`; the public app mount path, for example `/tools/opencode/`. Use a leading slash; a missing trailing slash is normalized. All public plugin URLs are underneath `<basePath>voice/`. |
| `proxyMode` | `preserve`; use `preserve` when Bun receives the public prefix, or `strip` when the proxy removes exactly `basePath` before forwarding. No automatic detection or forwarded-header inference. |
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

Open authenticated **`<basePath>voice/`** (`/voice/` at the origin root) to choose Groq or Custom, enter an encrypted API key, and edit the model, language, prompt, temperature, or Service limits:

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

1. Keep the current deployment working while preparing JSON. Record its exact origin, Bun port/bind address, upstream, database and encryption-key paths. Root deployments keep `basePath: "/"` and `proxyMode: "preserve"`; select a nested path only with matching proxy routing and an OpenCode app that supports it. Stage these in a file named `config.pending.json` while migrating, so default JSON discovery does not conflict with the still-running legacy setup; no database or master-key migration is needed.
2. Preserve the existing Caddy/Bun shared token in a private file. Point JSON and Caddy at that same value; paths can differ across container mounts. Do not generate a replacement unless deliberately rotating both sides.
3. If still using the legacy plaintext provider file, describe it with `legacyProvider` until you explicitly save an encrypted key in the page. Existing encrypted credentials retain precedence. Removing a saved key never reactivates the old file; historical plaintext files/backups are not automatically deleted.
4. Transfer any custom service limits to the Settings page. Starting once in legacy mode seeds missing SQLite limit fields from the previous environment values. Already-saved fields always win on subsequent starts, so later web changes survive restarts.
5. Remove legacy app variables from the service environment and any Bun-loaded `.env` files before enabling JSON. Rename the staged JSON to `config.json` and replace the old systemd `EnvironmentFile` startup with the new `--config` example, retaining your actual executable/repository paths. Validate and restart using your normal deployment process.

Legacy environment mode retains the root-path defaults; configure nested deployments with JSON. Compatibility is explicit: if the default JSON file is absent and legacy origin/token variables are present, the old environment configuration still starts with a warning. In that mode relative paths retain their previous launch-directory meaning. If JSON exists or `--config` is supplied, **any supported legacy app variable causes a clear conflict error, even when values match**. Nothing silently overrides JSON or changes paths. A missing explicit config never falls back. Existing `VOICE_PROXY_TOKEN_FILE` takes precedence over `VOICE_PROXY_TOKEN` in legacy mode, with a warning when both are set. [The old environment example](.env.example) remains for migration only.

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

No Caddy environment variables are required by the new examples. Edit the literal site address, backend ports, mount path where applicable, and token-file path. Replace `REPLACE_WITH_BCRYPT_HASH` with a hash generated interactively by `caddy hash-password`; the example username is `opencode`. The placeholder intentionally is not a valid installed password configuration.

Both the voice and HTML-injection reverse-proxy handlers use `header_up X-OCVD-Proxy-Token {file./path/to/opencode-voice/proxy.token}`. Point this at the private token file readable by Caddy. Its contents must match Bun's `proxyTokenFile` exactly, without a trailing newline; the setup command above generates this format. Share only that file with Caddy, not the master encryption key or the database. For containers, use an appropriately permissioned read-only mount and the path **inside Caddy's container**; Bun may use a different host path for the same contents. Grant only the service accounts the needed read access. Caddy's secret-file placeholders are documented in its [configuration concepts](https://caddyserver.com/docs/caddyfile/concepts#environment-variables).

Run `caddy validate --config /your/Caddyfile --adapter caddyfile`, then reload/restart through your existing deployment. CI validates the stock example and exercises actual Basic authentication, file-backed token forwarding, client-token overwrite and missing-file failure with dummy credentials. Older installed Caddy versions must be checked for file-placeholder support before migrating; keep the working old configuration until validation succeeds.

Authentication must cover **all `<basePath>voice/*` routes**, including worker, assets and settings APIs, as well as OpenCode. The proxy token is an additional Caddy-to-Bun check, not a substitute for user authentication: if Caddy accepts an anonymous caller and adds the token, that caller could use your paid transcription quota. Caddy overwrites `X-OCVD-Proxy-Token` rather than trusting a browser-supplied header.

If OpenCode has its own Basic authentication, forward its required Authorization header consistently on both the normal route and the HTML-injector route. The injector preserves incoming Authorization/Cookie headers only when calling the configured OpenCode upstream; they are never sent to the speech provider.

The standalone [Caddyfile](Caddyfile) keeps the root deployment working with the defaults. The optional replacement-module configuration also demonstrates the root path; do not route HTML through Bun and apply the replacement module at the same time. The module example requires the normal lowercase `<head>` opening tag and inserts a blocking script immediately after it. Use that optional variant only with CSP delivered by HTTP headers and no meta CSP; its literal insertion precedes meta policies and cannot safely preserve their boundary. Bun instead injects after policy metas and before the first app script; a meta CSP appearing after any script causes Bun to skip injection with `X-OCVD-Injection: skipped-late-meta-csp`. Unlike the parser-based Bun injector, that literal replacement does not cover head attributes, other casing, or a missing head. Prefer stock Caddy/Bun when the shell shape can vary. For a nested module setup, update its matchers and the injected script's `src` and `data-base-path` together, following the namespace below.

### Nested installations

`basePath` describes the **public OpenCode app mount**, not just a prefix for the transcription API. Use `/` or a canonical path with leading and trailing slashes, such as `/opencode/` or `/tools/team/opencode/`. Do not include a scheme, hostname, query, fragment, dot segments, or encoded separators. `publicOrigin` remains, for example, `https://opencode.example.com`, without any path. Redirect the bare app mount to its trailing-slash form at the proxy.

**OpenCode itself must already work under that public prefix.** This plugin configures only its own URLs and worker. It does not rewrite OpenCode's root-absolute asset/API URLs, router links, manifest, or redirects. Its narrowly targeted worker-registration interception is described above; it is not a general app URL rewriter. If your OpenCode build emits those from `/`, configure/build OpenCode for the chosen mount or supply a separate, complete external adaptation. Prefix stripping alone does not fix a root-only SPA. A dedicated root origin remains the simplest deployment for an unmodified root-only build. Verify OpenCode navigation, assets, API requests and streaming under the prefix before adding voice.

Choose exactly one forwarding contract and match the JSON setting to it. Prefix length/nesting does not matter. The plugin does not read `X-Forwarded-Prefix`, `X-Script-Name`, or client-supplied headers to determine its namespace, and does not accept both preserved and stripped plugin URLs in one mode. Keep Bun private: only the authenticated public mount may forward into it.

#### Prefix-preserving Caddy

Set `"basePath": "/tools/opencode/"` and `"proxyMode": "preserve"`. Both Bun and the configured OpenCode upstream receive `/tools/opencode/…`. The upstream must serve its app under this path. Caddy's [`handle`](https://caddyserver.com/docs/caddyfile/directives/handle) preserves the request path.

```caddyfile
opencode.example.com {
    basic_auth {
        opencode REPLACE_WITH_BCRYPT_HASH
    }
    handle /tools/opencode {
        redir * /tools/opencode/ 308
    }
    handle /tools/opencode/* {
        handle /tools/opencode/voice {
            redir * /tools/opencode/voice/ 308
        }
        handle /tools/opencode/voice/* {
            reverse_proxy 127.0.0.1:4097 {
                header_up X-OCVD-Proxy-Token {file./path/to/opencode-voice/proxy.token}
            }
        }
        @documents {
            method GET HEAD
            header Accept *text/html*
            not header Upgrade *
            not path /tools/opencode/api/* /tools/opencode/event /tools/opencode/global/event
        }
        handle @documents {
            reverse_proxy 127.0.0.1:4097 {
                header_up X-OCVD-Proxy-Token {file./path/to/opencode-voice/proxy.token}
            }
        }
        handle {
            reverse_proxy 127.0.0.1:4096
        }
    }
    # Retain your existing sibling-app handlers here instead, if any.
    handle {
        respond "Not found" 404
    }
}
```

#### Prefix-stripping Caddy

Set `"basePath": "/tools/opencode/"` and `"proxyMode": "strip"`. The browser still uses `/tools/opencode/voice/…`, but Bun receives `/voice/…`; OpenCode receives app paths without `/tools/opencode`. Caddy's [`handle_path`](https://caddyserver.com/docs/caddyfile/directives/handle_path) removes that prefix before the nested handlers run. The public base path in JSON remains unchanged. The upstream must still generate correct **public** prefixed URLs, either through its own configuration or the separate adaptation described above.

```caddyfile
opencode.example.com {
    basic_auth {
        opencode REPLACE_WITH_BCRYPT_HASH
    }
    handle /tools/opencode {
        redir * /tools/opencode/ 308
    }
    handle_path /tools/opencode/* {
        handle /voice {
            redir * /tools/opencode/voice/ 308
        }
        handle /voice/* {
            reverse_proxy 127.0.0.1:4097 {
                header_up X-OCVD-Proxy-Token {file./path/to/opencode-voice/proxy.token}
            }
        }
        @documents {
            method GET HEAD
            header Accept *text/html*
            not header Upgrade *
            not path /api/* /event /global/event
        }
        handle @documents {
            reverse_proxy 127.0.0.1:4097 {
                header_up X-OCVD-Proxy-Token {file./path/to/opencode-voice/proxy.token}
            }
        }
        handle {
            reverse_proxy 127.0.0.1:4096
        }
    }
    # Retain your existing sibling-app handlers here instead, if any.
    handle {
        respond "Not found" 404
    }
}
```

The inner `/voice/*` matcher in the stripping example is reached **only after** `/tools/opencode/*` matched and was stripped. It is not an origin-root alias. Adapt the site/authentication/token file and upstream ports as in the root example, and change every `/tools/opencode` occurrence together if using another mount. Validate the final configuration before reloading. Do not use `handle_path` for preserving mode or remove the prefix twice.

#### Deployment smoke check

With the real proxy and an authenticated browser, check all of the following before enabling voice broadly:

- The bare app and settings paths redirect inside the intended namespace with trailing slashes.
- The injected script follows all meta CSP policies and precedes the first app script, has the configured `data-base-path`, and its URL stays under `<basePath>voice/` even on deep session routes.
- Settings JavaScript/CSS, config, provider and transcription requests all stay under that same namespace. Unauthenticated requests to assets, worker and APIs are rejected. A forged browser token cannot replace Caddy's private value.
- `<basePath>voice/sw.js` returns JavaScript and `Service-Worker-Allowed: <basePath>`. The active worker uses exactly that script and scope; sibling registrations are untouched.
- The settings page loads and saves, recording can be reviewed, and explicit Send still uses OpenCode's native action. Use synthetic/test audio and a mocked provider before checking your real microphone/provider.
- OpenCode's own assets, API/streaming routes and deep-link navigation still work. Requests outside this app mount never reach Bun or expose its plugin routes.

See [the migration notes](#service-worker-scope-and-existing-installations) if an existing client still receives a cached shell without the microphone; repeated ordinary reloads or changing the plugin prefix alone do not guarantee recovery.

## 4. Open it in any modern browser

Open the usual OpenCode HTTPS address in any modern browser. The microphone appears beside the composer controls, with a settings gear linking to `<basePath>voice/` (`/voice/` for the root default). Because the injected code is served as part of the site, no userscript or browser extension is required. The browser/device must support the standard microphone/media APIs used by the app and must trust the site's certificate. Plain LAN HTTP is not suitable for microphone access.

Place the cursor where you want the text, then tap the microphone to record. While recording, choose the square **Stop and review** button or the up-arrow **Transcribe and send** button. Both use the latest saved editor selection at the moment recording stops. The settings gear is hidden while recording to leave room for the send action. Question inputs only offer review. The adapters handle both supported V2/beta composer dialects, question textareas, cursor-aware insertion, and verified Send-button checks. Recording, pending permission requests, and transcription are cancelled on session/input changes, cancellation, or page exit. Ctrl+Space remains available on desktop and always stops for review. Disable the userscript on this origin when using the injected edition; the shared initialization marker prevents two active instances, but the first one loaded would otherwise win.

Upstream CSP is preserved, not disabled. A restrictive policy must permit the same-origin namespaced script and fetches, the namespaced worker through `worker-src` (or its applicable fallback), and the shared UI's dynamic styles. A nonce-only policy may need an explicit integration adjustment; do not simply remove CSP. The plugin bootstrap must execute before OpenCode registers its worker. Also check that no proxy-level `Permissions-Policy` disables the microphone. The injector serves modified HTML with `Cache-Control: no-store`, but already-controlled cached pages still require the migration handling described above.

## REST API

Use the authenticated HTTPS origin; Caddy supplies its internal token. For the sample Basic-auth setup, curl prompts for the user's password without putting it in the command line. Replace the example hostname with your actual origin. These examples use the root default; for `basePath: "/tools/opencode/"`, use `/tools/opencode/voice/config` instead. All route names in the API/storage descriptions below are likewise relative to the configured public base. Keep provider-key entry in the web page.

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
bun run test

# Optional development-only type definitions and TypeScript checker.
bun install
bun run typecheck

# From repository root, using the existing browser-test tooling.
npm ci
npx playwright install chromium
npx playwright test --config server/playwright.config.ts
npx playwright test --config server/namespace.playwright.config.ts
```

The dedicated read-only `Bun voice server` workflow runs native Bun tests, strict type checking, mobile-viewport Chromium tests with synthetic audio, the existing userscript suite/build, a six-mount/proxy namespace and real service-worker matrix, and stock Caddy root/nested routing validation. Browser regressions cover review/edit/delete, native input-event activation, delayed Send readiness, both composer dialects, duplicate clicks, unavailable/Stop/shell buttons, edits during transcription, cancellation, session switches, empty/error results, recording limits, questions, and settings persistence. Cursor regressions also cover start/middle/end insertion, selection replacement, focus loss, keyboard dictation, frozen positions, Chinese/Unicode, multiline text, mention/attachment preservation, text-node rerenders, and invalidated positions. Root Biome and Vitest coverage remain scoped away from this separate Bun distribution; the original userscript coverage thresholds are unchanged. No test calls a real paid speech API or uses your credentials. A real browser/device microphone and your existing Caddy installation still require a deployment smoke test.

Reference documentation: [Bun HTTP](https://bun.com/docs/runtime/http/server), [Bun SQLite](https://bun.com/docs/runtime/sqlite), [Groq speech-to-text](https://console.groq.com/docs/speech-to-text), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [optional replacement module](https://github.com/caddyserver/replace-response).
