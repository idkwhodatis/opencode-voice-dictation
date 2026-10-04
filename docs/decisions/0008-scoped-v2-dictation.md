# ADR 0008: Explicit site scope and session-safe V2 dictation

- Date: 2026-10-04
- Status: Accepted for this fork
- Baseline: `bc673e7`, version 1.0.5

## Verified source, not guessed selectors

OpenCode default `dev` was inspected at
[`907b3bc518fa48e90e8ec24dd327d13eee71c36c`](https://github.com/anomalyco/opencode/tree/907b3bc518fa48e90e8ec24dd327d13eee71c36c).

- [`session-ui/.../prompt-input/index.tsx`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/session-ui/src/v2/components/prompt-input/index.tsx#L110-L182): V2 uses a `form[data-component="prompt-input-v2"]` containing the **same** `[data-component="prompt-input"][contenteditable="true"]` editor. Removing that editor selector would break V2.
- Its `onInput` parses text and mention nodes, adds existing image parts, then updates the controller. Appending at a collapsed end range and dispatching `input` preserves this contract. The insertion/fallback follows the component's own [paste path](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/session-ui/src/v2/components/prompt-input/interaction.ts#L374-L401).
- The [submit control](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/session-ui/src/v2/components/prompt-input/index.tsx#L672-L713) reuses `data-action="prompt-submit"` for Send, Stop and shell mode. [`IconButton`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/ui/src/components/icon-button.tsx#L15-L20) provides `data-icon`. Auto-submit only clicks an enabled `arrow-up` button within the captured composer.
- The [legacy editor](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/app/src/components/prompt-input.tsx#L1516-L1530) still exists in source. Keep the existing cheap wrapper fallback order from ADR 0001; require a real editable child. This does not claim all old released UIs were browser-tested.

## Decisions

1. Ship one inert `@match https://opencode.invalid/*` and `@noframes`. Explicit Tampermonkey **User matches** supplies a dedicated-host deployment scope. Match rules ignore ports; port-specific localhost uses an anchored **User includes** regular expression instead, with no broad localhost match. No all-sites match and no page-detection polling.
2. Mount through one mutation observer; track `urlchange` (Tampermonkey), `popstate`, `hashchange`, and DOM replacement. Each recording captures its route, composer and editor. A context change cancels, aborts in-flight transcription and invalidates late callbacks. Never migrate a transcript to a new session.
3. Append only. Keep mentions and attachments, fire framework-recognized input, use current Send state after a frame. Auto-submit remains OFF by default.
4. Preserve GM-backed settings and proxy support (`@connect *` controls request destinations, not page execution). Only the user-configured endpoint receives audio/key. New endpoint settings require HTTPS and warn that the proxy receives both. Keys are never placed in source, page DOM, logs or error response echoes.
5. Handle pending mic permission, cancellation while processing, recorder errors, MIME selection and request timeouts. No retry that could create a second billable call.
6. This fork distributes committed `master/dist` files and checks build parity in read-only CI. Remove the upstream `main`→`dist` write-capable deploy workflow. Install/update URLs point only at `idkwhodatis`.

## Verification boundary

Unit/DOM tests mock microphone and requests. Chromium runs the built userscript against a source-shaped V2 fixture, using real browser selection/`execCommand` and input events. This is **not** a live OpenCode server or a Tampermonkey-installed extension test. No real microphone permission, recording, API key, Groq request or paid transcription was used. Firefox/mobile and actual extension User-match enforcement remain manual checks.

## Official references

- [Tampermonkey User matches](https://www.tampermonkey.net/faq.php?locale=en#Q103)
- [Match metadata](https://www.tampermonkey.net/documentation.php?q=include#meta:match)
- [URL-change events](https://www.tampermonkey.net/documentation.php?q=window#api:window.onurlchange)
- [GM requests, abort and timeout](https://www.tampermonkey.net/documentation.php?q=GM_xmlhttpRequest)
- [Groq transcription endpoint, models, language and file formats](https://console.groq.com/docs/speech-to-text)

- [Tampermonkey ports are ignored in match rules](https://www.tampermonkey.net/changelog.php?locale=en&more=true&show=gcal)
