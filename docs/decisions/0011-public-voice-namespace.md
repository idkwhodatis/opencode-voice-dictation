# ADR 0011: Keep the injected edition inside its public app namespace

- Status: accepted
- Scope: server-injected edition; userscript unchanged

## Context

An origin-root `/voice/` constant prevents hosting more than one application under
one HTTPS origin. A permanent `/sw.js` proxy override also escapes the plugin's
namespace and can interfere with another app. OpenCode's Workbox navigation
cache presents a separate problem: it can return an old, uninjected app shell
without reaching the proxy or honoring the new HTML response's cache headers.

## Decision

Startup JSON supplies `basePath`, default `/`, and `proxyMode`, default
`preserve`. The public plugin namespace is always `<basePath>voice/`, including
browser code, settings code/styles, settings/provider/transcription APIs, health,
and the no-op worker. The settings redirect stays inside that namespace. Missing
trailing slashes in configuration are normalized; unsafe or ambiguous path
syntax is rejected. No forwarded-prefix header configures the public path.

`preserve` requires Bun requests to retain the public mount. `strip` requires the
trusted reverse proxy to remove the mount before forwarding. One mode is selected
explicitly; the service does not infer it per request or publish a second set of
public aliases. The proxy authenticates both HTML and all plugin endpoints and
overwrites its private token header before forwarding to the private Bun service.
The deployment guide provides complete nested Caddy examples for both contracts.

The HTML injector inserts a parser-blocking external script after meta CSP
policies and before app scripts. A policy appearing after
a script causes injection to be skipped rather than bypassing CSP. This bootstrap must run before OpenCode's worker registration and keeps
worker registration within the configured app scope. The no-op worker is served
at `<basePath>voice/sw.js` with `Service-Worker-Allowed: <basePath>` and registered
with that exact scope. It bypasses navigation caching without a permanent sibling
worker endpoint. Cleanup is limited to the default Workbox precache name for
that exact scope; unrelated registrations and caches are left intact.

## Deployment boundary

These settings do not turn a root-only OpenCode build into a subpath-capable
application. OpenCode's own asset URLs, API URLs, redirects, manifest, routing,
and other non-plugin behavior must already support the public prefix or have a
separate complete adaptation. Prefix stripping alone cannot repair absolute
browser URLs. The root defaults remain usable with a root-hosted OpenCode app.

A previously controlling cached shell may never execute the new bootstrap.
Affected clients need a one-time application-specific unregister/network reload,
or an operator-managed temporary update bridge at the exact app-owned legacy
worker URL. There is no safe automatic repair for arbitrary other applications'
workers or caches. The guide describes this limitation instead of promising that
a new script or HTML cache header can update a page that never loads it.

CSP remains enforced. Operators must permit the namespaced external script,
worker and same-origin requests, and any required UI styles. The optional Caddy
replacement-module example must preserve the same early blocking-script order;
the stock Bun parser remains preferred over a literal HTML replacement.

## Verification

Check root and nested mounts, both forwarding modes, deep links, canonical
redirects, exact worker scope, and already-controlled pages. Confirm unrelated
registrations/caches survive and no plugin traffic leaks to origin-root aliases
when using a subpath. Keep authentication, token overwrite, provider encryption,
same-origin checks and explicit recording-send behavior intact.
