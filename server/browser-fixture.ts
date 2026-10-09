// Test-only HTTP fixture: synthetic audio + mocked provider. Never used by main.ts.
import { buildAssets } from "./main";
import { createService } from "./service";
import { DEFAULT_SETTINGS, openSettings } from "./settings";

const origin = "http://127.0.0.1:44097";
const token = "test-proxy-token-".repeat(4);
const store = openSettings(":memory:");
let delay = 0;
let calls = 0;
let lastModel: FormDataEntryValue | null = null;
const shell = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>button[data-action]{width:28px;height:28px;padding:4px}button svg{width:18px;height:18px}</style>
</head><body>
<form data-component="composer">
  <div data-component="composer-editor" contenteditable="true"><span contenteditable="false" data-mention="true">@context</span> existing</div>
  <div style="display:flex;align-items:center">
    <button type="button" data-action="composer-attach">+</button>
    <button type="button">Model</button>
    <button type="button" data-action="composer-submit" data-icon="arrow-up">Send</button>
  </div>
</form>
<script>window.sendCount=0;document.querySelector('[data-action="composer-submit"]').onclick=()=>window.sendCount++;</script>
</body></html>`;
const handler = createService({
  origin, proxyToken: token, upstream: "http://127.0.0.1:4096",
  endpoint: "https://provider.example.test/transcribe", getApiKey: async () => "test-key-never-sent-to-browser",
  settings: store, requestsPerMinute: 1000,
  assets: await buildAssets(),
  fetcher: (async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(input)).hostname === "127.0.0.1") return new Response(shell, { headers: { "Content-Type": "text/html" } });
    calls++;
    lastModel = (init?.body as FormData).get("model");
    if (delay) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("cancelled")); }, { once: true });
    });
    return Response.json({ text: "Hello 你好 <img onerror=bad()>" });
  }) as typeof fetch,
});
Bun.serve({ hostname: "127.0.0.1", port: 44097, async fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/__test/reset" && req.method === "POST") {
    delay = 0; calls = 0; lastModel = null; store.patch(DEFAULT_SETTINGS); return Response.json({ ok: true });
  }
  if (path === "/__test/delay" && req.method === "POST") { delay = 1000; return Response.json({ ok: true }); }
  if (path === "/__test/state") return Response.json({ calls, lastModel });
  const headers = new Headers(req.headers); headers.set("X-OCVD-Proxy-Token", token);
  return handler(new Request(req, { headers }));
} });
