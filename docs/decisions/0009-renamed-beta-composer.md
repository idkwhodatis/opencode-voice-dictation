# ADR 0009: Support the renamed beta composer

- Date: 2026-10-05
- Status: Accepted
- Userscript version: 1.1.2

## Evidence

A reported deployment had the initialized userscript marker and working settings
menus, but no injected controls. Its composer used different DOM markers from
OpenCode's default `dev` branch. Only the UI structure was retained in the
regression fixture; no original saved page, conversations, URLs or credentials
are committed.

The structure is confirmed in official OpenCode **beta**, commit
[`e5ecb5719de37759e06c57ff05ffc668e98f6f30`](https://github.com/anomalyco/opencode/tree/e5ecb5719de37759e06c57ff05ffc668e98f6f30):

- [`editor.tsx`](https://github.com/anomalyco/opencode/blob/e5ecb5719de37759e06c57ff05ffc668e98f6f30/packages/app/src/composer/editor/editor.tsx#L125-L200): `form[data-component="composer"]` contains `[data-component="composer-editor"][contenteditable="true"]`. Its input handler still parses text/mentions and retains image parts before updating framework state.
- [Submit button](https://github.com/anomalyco/opencode/blob/e5ecb5719de37759e06c57ff05ffc668e98f6f30/packages/app/src/composer/editor/editor.tsx#L822-L855): `data-action="composer-submit"`; normal Send, Stop and shell use different icons. The new IconButton no longer exposes the old `data-icon` attribute. Its SVG uses the `#opencode-v2-icon-arrow-up` sprite for normal Send.
- [`interaction.ts`](https://github.com/anomalyco/opencode/blob/e5ecb5719de37759e06c57ff05ffc668e98f6f30/packages/app/src/composer/editor/interaction.ts#L352-L405): `input` continues to update the prompt store. Native insertion plus input notification remains the supported route.

## Decision

Prepend the verified `form[data-component="composer"]` adapter while preserving
the existing stable/legacy wrapper order. Recognize both editor names. For
optional auto-submit, select within the captured composer and accept only an
enabled Send button carrying the known old attribute or new exact SVG sprite.
Do not use translated labels or blindly click the renamed submit control: it can
also stop an agent or execute a shell command.

This is independent of microphone access. An insecure HTTP LAN page can still
show the controls, but recording requires HTTPS or localhost and browser
permission. No CSP relaxation is needed.

## Verification

Four added DOM regressions failed against 1.1.1 and pass with this fix: editor
capture/rich append, Send/Stop/shell gating, stale/disabled editor rejection, and
single-control mounting across composer recreation. Chromium fixtures exercise
both DOM dialects. Microphone and Groq remain mocked; no live recording is sent.
