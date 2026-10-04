# opencode-voice-dictation

Project-specific rules for agents. This file **complements** the global `~/.config/opencode/AGENTS.md` (orchestrator model, pipeline, code style) — it does NOT replace it. Both are loaded together by opencode.

## Version bump (CRITICAL)

Bump `version` in **both** files synchronously on every PR touching `src/`, `vite.config.ts`, or `tests/`:

- `vite.config.ts` → `userscript.version` (vite-plugin-monkey reads `@version` from here, NOT from `package.json`)
- `package.json` → `version` (for npm/semver tooling only)

Desync (bumping only one file) = userscript managers (Tampermonkey/Violentmonkey) do not see the auto-update even though npm sees the new version. Without a bump at all, auto-update never triggers.

## `@connect`

`vite.config.ts` `userscript.connect` generates the `@connect` metablock. Currently `*` (user-configurable endpoint — the domain is not known ahead of time). Do NOT narrow it back to `api.groq.com` — that breaks custom STT proxies (Groq IP-block workarounds via user nginx `proxy_pass`).

## Dist deploy

This fork distributes committed `dist/` artifacts on `master`. Install/update URLs must point to `idkwhodatis/opencode-voice-dictation/master/dist/`. Run `npm run build` before committing. Read-only CI runs the aggregate checks and verifies `git diff --exit-code -- dist/`. The upstream deployment workflow is intentionally removed; see ADR 0008.

## `@icon`

`vite.config.ts` `userscript.icon` → `master/assets/icon.png` (128×128 PNG RGBA). Do NOT delete `assets/icon.png` and do NOT change the path without editing both the file location and the `icon` URL in sync.

## Composer selectors (brief)

`COMPOSER_SELECTORS` in `src/ui.ts` — order = detection priority (primary → fallback). Current order: `prompt-input-v2` → `session-prompt-dock` → `session-new-composer` → `session-composer`. Do NOT change the order without an ADR. `session-prompt-dock` is a wrapper for three conditionally-rendered blocks; the guard checks for a real composer (`prompt-input`/`prompt-input-v2`) inside the dock. See ADR 0001–0004 in `docs/decisions/`.

## Stack

Vite 6 + vite-plugin-monkey 5 + TypeScript 5.7 (strict) + Biome 1.9.4 (2-space, 100 width, double quotes, semicolons, trailing commas, `noExplicitAny: error`) + Vitest 3 + Knip 6.24. Node 22 (`.nvmrc`), `engines: node >=20`.

## Commands

- `npm run lint` (biome check)
- `npm run typecheck` (`tsc --noEmit`)
- `npm run test` (`vitest run`)
- `npm run knip` (dead-code)

Coverage thresholds: 60%.

## src/ structure

- `index.ts` — entry; `app.ts` — settings and cancellable dictation lifecycle
- `audio.ts` — `MediaRecorder` (webm/opus)
- `transcribe.ts` — `GM_xmlhttpRequest` to `config.endpoint`
- `config.ts` — `GM_getValue`/`GM_setValue`, 7 menu commands
- `insert.ts` — DOM manipulation, contenteditable
- `ui.ts` — mic button inject, `MutationObserver`
- `keyboard.ts` — Ctrl+Space
- `types.ts` — `AppConfig`

## Tests

Vitest + `happy-dom`. The `$` module (vite-plugin-monkey's `GM_*` alias) is mocked at `tests/__mocks__/$/index.ts` via vitest `resolve.alias`. Coverage excludes `index.ts`, `ui.ts`, `audio.ts`, `types.ts`; they still have focused lifecycle tests. Chromium tests use only synthetic audio and a mocked endpoint. Run `npm run check` for the aggregate suite (install Playwright Chromium first).