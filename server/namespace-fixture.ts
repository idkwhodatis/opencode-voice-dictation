// Test-only, real HTTP reverse proxies and app workers. No service-worker APIs are mocked.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAssets } from "./main";
import { openProviderStore } from "./provider";
import { createService } from "./service";
import { DEFAULT_SETTINGS, openSettings } from "./settings";

const token = "namespace-fixture-proxy-token-".repeat(3);
const key = "TEST_ONLY_SYNTHETIC_PROVIDER_KEY";
const assets = await buildAssets();
const directory = mkdtempSync(join(tmpdir(), "ocvd-namespace-"));
const servers: ReturnType<typeof Bun.serve>[] = [];
const cleanups: (() => void)[] = [];
const bases = ["/", "/opencode/", "/apps/ai/opencode/"];
const modes = ["preserve", "strip"] as const;

function html(body: string) {
  return new Response(body, {
    headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
  });
}
function script(body: string, scope: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/javascript",
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": scope,
    },
  });
}
const passiveWorker = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));`;

for (const [baseIndex, basePath] of bases.entries()) {
  for (const [modeIndex, proxyMode] of modes.entries()) {
    const index = baseIndex * 2 + modeIndex;
    const port = 44110 + index;
    const origin = `http://127.0.0.1:${port}`;
    const providerOrigin = `http://127.0.0.1:${44310 + index}`;
    const endpoint = `${providerOrigin}/transcribe`;
    const upstreamOrigin = `http://127.0.0.1:${44210 + index}`;
    const settings = openSettings(":memory:");
    const provider = openProviderStore(":memory:", join(directory, `key-${index}`));
    const state = {
      enabled: true,
      legacyMode: "cached",
      blockScripts: false,
      requests: [] as { method: string; publicPath: string; servicePath: string }[],
      upstreamPaths: [] as string[],
      providerCalls: 0,
      lastModel: "",
      lastAudioBytes: 0,
    };
    const reset = () => {
      state.enabled = true;
      state.legacyMode = "cached";
      state.blockScripts = false;
      state.requests.length = 0;
      state.upstreamPaths.length = 0;
      state.providerCalls = 0;
      state.lastModel = "";
      state.lastAudioBytes = 0;
      settings.patch(DEFAULT_SETTINGS);
      provider.save({ provider: "custom", endpoint, apiKey: key });
    };
    reset();
    cleanups.push(() => {
      provider.close();
      settings.close();
    });
    servers.push(
      Bun.serve({
        hostname: "127.0.0.1",
        port: 44310 + index,
        async fetch(req) {
          if (req.method !== "POST" || req.headers.get("authorization") !== `Bearer ${key}`) {
            return new Response("Unexpected mock provider request", { status: 400 });
          }
          const form = await req.formData();
          state.providerCalls++;
          state.lastModel = String(form.get("model"));
          const audio = form.get("file");
          state.lastAudioBytes = audio instanceof File ? audio.size : 0;
          return Response.json({ text: "Mounted voice transcript" });
        },
      }),
    );

    const shell = `<!doctype html><html><head><meta charset="utf-8">
<script>
window.appRegistrationStarted = true;
window.appRegistrationResult = navigator.serviceWorker.register(${JSON.stringify(`${basePath}sw.js`)}, {scope:${JSON.stringify(basePath)}})
  .then(registration => ({scope:registration.scope, script:(registration.active || registration.installing || registration.waiting)?.scriptURL}))
  .catch(error => ({error:String(error)}));
window.stockRegistrationResult = navigator.serviceWorker.register("/sw.js", {scope:"/"})
  .then(registration => ({scope:registration.scope, script:(registration.active || registration.installing || registration.waiting)?.scriptURL}))
  .catch(error => ({error:String(error)}));
</script></head><body><h1 id="network-shell">Network OpenCode fixture</h1>
<form data-component="composer">
<div data-component="composer-editor" contenteditable="true">Existing draft</div>
<div style="display:flex;align-items:center"><button type="button" data-action="composer-attach">+</button>
<button type="button" data-action="composer-submit" data-icon="arrow-up">Send</button></div></form>
<script>window.sendCount=0;document.querySelector('[data-action="composer-submit"]').onclick=()=>window.sendCount++;</script>
</body></html>`;
    const cachedShell =
      "<!doctype html><html><head></head><body><h1 id=legacy-cached-shell>Cached legacy OpenCode shell</h1></body></html>";
    const legacyWorker = () => `${passiveWorker}
const cacheName = ${JSON.stringify(`workbox-precache-v2-${origin}${basePath}`)};
const shellURL = new URL(${JSON.stringify(`${basePath}index.html`)}, self.location.origin).href;
self.addEventListener("install", event => event.waitUntil(caches.open(cacheName).then(cache => cache.put(shellURL,
 new Response(${JSON.stringify(cachedShell)}, {headers:{"Content-Type":"text/html"}})))));
self.addEventListener("fetch", event => {
 if(event.request.mode !== "navigate" || new URL(event.request.url).pathname.startsWith("/__namespace/")) return;
 const cached = () => caches.open(cacheName).then(cache => cache.match(shellURL));
 event.respondWith(${state.legacyMode === "cached" ? "cached()" : "fetch(event.request).catch(cached)"});
});`;
    servers.push(
      Bun.serve({
        hostname: "127.0.0.1",
        port: 44210 + index,
        fetch(req) {
          const path = new URL(req.url).pathname;
          state.upstreamPaths.push(path);
          const appPath = proxyMode === "strip" ? path : path.slice(basePath.length - 1);
          if (appPath === "/sw.js") return script(legacyWorker(), basePath);
          if (appPath === "/__network-probe") return new Response("network-probe");
          return html(
            state.blockScripts
              ? shell.replace(
                  "<script>",
                  `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">\n<script>`,
                )
              : shell,
          );
        },
      }),
    );
    const handler = createService({
      origin,
      basePath,
      proxyMode,
      proxyToken: token,
      upstream: upstreamOrigin,
      settings,
      provider,
      assets,
      requestsPerMinute: 1000,
    });
    servers.push(
      Bun.serve({
        hostname: "127.0.0.1",
        port,
        async fetch(req) {
          const url = new URL(req.url);
          const path = url.pathname;
          if (path === "/__namespace/reset" && req.method === "POST") {
            reset();
            return Response.json({ ok: true });
          }
          if (path === "/__namespace/deployment" && req.method === "POST") {
            const value = (await req.json()) as {
              enabled: boolean;
              legacyMode?: string;
              blockScripts?: boolean;
            };
            state.enabled = value.enabled;
            if (value.legacyMode) state.legacyMode = value.legacyMode;
            if (value.blockScripts !== undefined) state.blockScripts = value.blockScripts;
            return Response.json({ ok: true });
          }
          if (path === "/__namespace/state")
            return Response.json({ ...state, basePath, proxyMode, endpoint });
          if (path === "/__namespace/seed")
            return html("<!doctype html><title>Service worker setup</title>");
          if (path === "/other/sw.js") return script(passiveWorker, "/other/");
          if (path === "/site-sw.js") return script(passiveWorker, "/");
          if (path.startsWith("/other/"))
            return html("<!doctype html><h1>Unrelated application</h1>");
          if (!path.startsWith(basePath))
            return new Response("Outside application mount", { status: 404 });
          const servicePath = proxyMode === "strip" ? path.slice(basePath.length - 1) : path;
          if (!state.enabled) {
            return fetch(new URL(`${servicePath}${url.search}`, upstreamOrigin), req);
          }
          state.requests.push({ method: req.method, publicPath: path, servicePath });
          const internal = new URL(req.url);
          internal.pathname = servicePath;
          const headers = new Headers(req.headers);
          headers.set("X-OCVD-Proxy-Token", token);
          return handler(new Request(internal, new Request(req, { headers })));
        },
      }),
    );
  }
}

console.info("Namespace browser fixtures ready on ports 44110–44115");
function stop() {
  for (const server of servers) void server.stop(true);
  for (const cleanup of cleanups) cleanup();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
