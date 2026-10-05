# ADR 0010: Place dictation beside native Submit

- Status: accepted
- Userscript version: 1.1.3

The user requested a default hover cursor, a mic beside Submit, and matching
native button sizing. Composer controls now sit immediately before Submit in its
existing action row. Question inputs retain their separate placement.

Both verified OpenCode versions use a 28px Submit class, 6px padding and a 16px
SVG viewport. The older V2 form puts Submit directly in its bottom toolbar;
the renamed beta form adds `data-slot="composer-actions"`:

- [Old V2 toolbar and Submit](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/session-ui/src/v2/components/prompt-input/index.tsx)
- [Beta toolbar and Submit](https://github.com/anomalyco/opencode/blob/e5ecb5719de37759e06c57ff05ffc668e98f6f30/packages/app/src/composer/editor/editor.tsx)
- [Beta Tooltip](https://github.com/anomalyco/opencode/blob/e5ecb5719de37759e06c57ff05ffc668e98f6f30/packages/ui/src/overlays/tooltip/tooltip.tsx) wraps enabled Submit in `tooltip-v2-trigger`, and omits that wrapper when inactive. Dictation is inserted before the wrapper so it does not inherit the Send/Stop tooltip.

A ResizeObserver measures the actual native button and SVG, copying only box
size, padding and corner radius. This follows native styling instead of copying
Send's identity, handlers, disabled state or submit behavior. The verified sizes
are fallbacks for an initially hidden row. Mic and Cancel both use the default
cursor.

Insertion moves the existing controls only when their parent or adjacent anchor
changes. Subtree mutations handle lazy Submit, tooltip toggles, alternate actions,
row replacement and session recreation without self-triggered mutation loops.
No recording, request, insertion or auto-submit behavior changed.

Validation uses sanitized fixtures for both DOM versions: settled mutations,
row/Submit/tooltip replacement, and Chromium box/padding/icon/cursor comparisons
at 1024px and 320px widths. Recording and Cancel expansion must stay on the same
row without document overflow. Native resizing is also checked. Audio and Groq
remain mocked; no private saved page or recording is included.
