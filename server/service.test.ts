import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createService, readLimitedBody, type ServiceOptions } from "./service";
import { DEFAULT_SETTINGS, openSettings, validatePatch } from "./settings";
import { buildBrowser } from "./main";

const TOKEN = "a".repeat(64);
const KEY = "test-server-only-provider-secret";
const ORIGIN = "https://voice.example.test";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture(overrides: Partial<ServiceOptions> = {}) {
  const settings = openSettings(":memory:");
  cleanup.push(() => settings.close());
  const handler = createService({
    origin: ORIGIN, proxyToken: TOKEN, upstream: "http://127.0.0.1:4096",
    endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    settings, getApiKey: async () => KEY, assets: new Map([
      ["/voice/voice.js", { body: "/* public script */", type: "text/javascript" }],
      ["/voice/", { body: "<!doctype html><title>Settings</title>", type: "text/html" }],
    ]),
    fetcher: mockFetch(async () => Response.json({ text: "Hello 你好" })),
    ...overrides,
  });
  return { handler, settings };
}
function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { "X-OCVD-Proxy-Token": TOKEN, "X-OCVD-Request": "1", Origin: ORIGIN, ...init.headers },
  });
}
function recording(init: RequestInit = {}) {
  return request("/voice/transcribe", {
    method: "POST", body: new Uint8Array([1, 2, 3, 4]), ...init,
    headers: { "Content-Type": "audio/webm;codecs=opus", ...init.headers },
  });
}
const mockFetch = (fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;

describe("SQLite settings", () => {
  test("defaults and atomic partial updates survive reopening", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocvd-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "settings.sqlite");
    let store = openSettings(path);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    store.patch({ model: "whisper-large-v3", whisperPrompt: "张三's API; DROP TABLE settings;", autoSubmit: true });
    expect(() => store.patch({ model: "valid", temperature: 9 })).toThrow();
    expect(store.get().model).toBe("whisper-large-v3");
    store.close();
    store = openSettings(path);
    expect(store.get().whisperPrompt).toBe("张三's API; DROP TABLE settings;");
    expect(store.get().autoSubmit).toBe(true);
    store.close();
  });
  test.each([null, [], "x", { model: "" }, { language: "EN" }, { autoSubmit: "false" },
    { temperature: NaN }, { temperature: -1 }, { whisperPrompt: "x".repeat(2001) },
    { apiKey: "secret" }, { endpoint: "https://evil.test" }, { keyFile: "/etc/passwd" },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ].map((patch) => [patch]))("rejects invalid or server-only settings: %j", (patch) => {
    expect(() => validatePatch(patch)).toThrow();
  });
  test("rejects a newer database rather than resetting it", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocvd-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "settings.sqlite");
    const db = new Database(path); db.run("PRAGMA user_version = 999"); db.close();
    expect(() => openSettings(path)).toThrow("Unsupported");
  });
});

describe("authentication and REST", () => {
  test("rejects missing/wrong proxy credentials, including same-length tokens", async () => {
    const { handler } = fixture();
    for (const token of ["", "short", "b".repeat(64)]) {
      const res = await handler(request("/voice/config", { headers: { "X-OCVD-Proxy-Token": token } }));
      expect(res.status).toBe(401);
    }
  });
  test.each(["https://evil.test", "null", "http://voice.example.test"])("rejects Origin %s", async (origin) => {
    const { handler } = fixture();
    expect((await handler(request("/voice/config", { headers: { Origin: origin } }))).status).toBe(403);
  });
  test("rejects cross-site AND sibling-subdomain browser requests", async () => {
    const { handler } = fixture();
    for (const site of ["cross-site", "same-site"]) {
      expect((await handler(request("/voice/config", { headers: { "Sec-Fetch-Site": site } }))).status).toBe(403);
    }
  });
  test("requires mutation marker and correct content type", async () => {
    const { handler } = fixture();
    expect((await handler(recording({ headers: { "X-OCVD-Request": "" } }))).status).toBe(403);
    expect((await handler(request("/voice/config", { method: "PATCH", body: "{}" }))).status).toBe(415);
  });
  test("returns only safe config, accepts partial updates, never exposes the key", async () => {
    const { handler } = fixture();
    const res = await handler(request("/voice/config", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "whisper-large-v3", language: "zh" }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const text = await res.text(); expect(text).not.toContain(KEY); expect(text).not.toContain(TOKEN);
    const data = JSON.parse(text);
    expect(data.apiKeyConfigured).toBe(true);
    expect(data.settings.model).toBe("whisper-large-v3");
    expect(data.settings.autoSubmit).toBe(false);
  });
  test("invalid JSON, forbidden fields and large settings payloads fail", async () => {
    const { handler } = fixture();
    for (const body of ["{", '{"endpoint":"https://evil.test"}', '[]']) {
      expect((await handler(request("/voice/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body }))).status).toBe(400);
    }
    expect((await handler(request("/voice/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: " ".repeat(16385) }))).status).toBe(413);
  });
  test("missing key is reported without exposing filesystem exceptions", async () => {
    const { handler } = fixture({ getApiKey: async () => { throw new Error("SECRET_PATH_AND_CONTENTS"); } });
    expect((await (await handler(request("/voice/config"))).json()).apiKeyConfigured).toBe(false);
    const res = await handler(recording());
    expect(res.status).toBe(503); expect(await res.text()).not.toContain("SECRET_PATH");
  });
  test("assets are allowlisted; no filesystem/key/config-file route exists", async () => {
    const { handler } = fixture();
    expect((await handler(request("/voice/voice.js"))).status).toBe(200);
    expect((await handler(request("/voice/settings.sqlite"))).status).toBe(404);
    expect((await handler(request("/voice/groq.key"))).status).toBe(404);
    expect((await handler(request("/voice/.env"))).status).toBe(404);
    const res = await handler(request("/voice/"));
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
});

describe("transcription", () => {
  test("forwards only audio and saved settings, not browser credentials; rotates keys", async () => {
    let key = KEY;
    const calls: { auth: string | null; form: FormData }[] = [];
    const { handler, settings } = fixture({
      getApiKey: async () => key,
      fetcher: mockFetch(async (url, init) => {
        expect(String(url)).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
        expect(init?.redirect).toBe("error");
        const headers = new Headers(init?.headers);
        expect(headers.get("Cookie")).toBeNull();
        expect(headers.get("X-OCVD-Proxy-Token")).toBeNull();
        calls.push({ auth: headers.get("Authorization"), form: init?.body as FormData });
        return Response.json({ text: "  Hello 你好  " });
      }),
    });
    settings.patch({ model: "whisper-large-v3", language: "zh", whisperPrompt: "OpenCode, Bun", temperature: 0.2 });
    const res = await handler(recording({ headers: { Authorization: "Basic browser-password", Cookie: "session=private" } }));
    expect(await res.json()).toEqual({ text: "Hello 你好", autoSubmit: false });
    expect(calls[0].auth).toBe(`Bearer ${KEY}`);
    expect(calls[0].form.get("model")).toBe("whisper-large-v3");
    expect(calls[0].form.get("language")).toBe("zh");
    expect(calls[0].form.get("prompt")).toBe("OpenCode, Bun");
    expect(calls[0].form.get("temperature")).toBe("0.2");
    const file = calls[0].form.get("file") as File;
    expect(file.name).toBe("recording.webm"); expect(file.size).toBe(4);
    key = "rotated-secret";
    await handler(recording()); expect(calls[1].auth).toBe("Bearer rotated-secret");
  });
  test("does not upload invalid, empty, or oversized audio", async () => {
    let calls = 0;
    const { handler } = fixture({ maxAudioBytes: 3, fetcher: mockFetch(async () => { calls++; return Response.json({ text: "" }); }) });
    expect((await handler(recording({ headers: { "Content-Type": "text/html" } }))).status).toBe(415);
    expect((await handler(recording({ body: new Uint8Array() }))).status).toBe(400);
    expect((await handler(recording())).status).toBe(413);
    expect(calls).toBe(0);
  });
  test.each([400, 401, 403, 429, 500, 302])("redacts provider error HTTP %d", async (status) => {
    const { handler } = fixture({ fetcher: mockFetch(async () => new Response(KEY, { status })) });
    const res = await handler(recording());
    expect(res.status).toBe(status === 429 ? 429 : 502);
    expect(await res.text()).not.toContain(KEY);
  });
  test.each(['<html>bad gateway</html>', '{"not_text":"oops"}'])("rejects invalid provider response %s", async (body) => {
    const { handler } = fixture({ fetcher: mockFetch(async () => new Response(body)) });
    expect((await handler(recording())).status).toBe(502);
  });
  test("enforces rate limits", async () => {
    const { handler } = fixture({ requestsPerMinute: 1 });
    expect((await handler(recording())).status).toBe(200);
    const res = await handler(recording()); expect(res.status).toBe(429); expect(res.headers.get("Retry-After")).toBe("60");
  });
  test("enforces concurrent-call cap and snapshots auto-submit", async () => {
    let release!: (res: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const { handler, settings } = fixture({ maxConcurrent: 1, fetcher: mockFetch(async () => {
      started(); return new Promise<Response>((resolve) => { release = resolve; });
    }) });
    const first = handler(recording()); await ready;
    settings.patch({ autoSubmit: true });
    expect((await handler(recording())).status).toBe(429);
    release(Response.json({ text: "hello" }));
    expect((await (await first).json()).autoSubmit).toBe(false);
  });
  test("provider timeout releases its concurrency slot", async () => {
    const { handler } = fixture({ timeoutMs: 10, fetcher: mockFetch(async (_, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error(KEY)), { once: true });
    })) });
    expect((await handler(recording())).status).toBe(504);
    expect((await handler(recording())).status).toBe(504);
  });
  test("client cancellation reaches the provider", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let cancelled = false;
    const { handler } = fixture({ fetcher: mockFetch(async (_, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => { cancelled = true; reject(new Error("abort")); }, { once: true });
      started();
    })) });
    const controller = new AbortController();
    const pending = handler(recording({ signal: controller.signal })); await ready; controller.abort();
    expect((await pending).status).toBe(504); expect(cancelled).toBe(true);
  });
});

describe("HTML-only injection", () => {
  test("preserves CSP/auth, strips caches and proxy token, fixes origin, injects once", async () => {
    let target = "";
    let incoming = new Headers();
    const csp = "script-src 'self'; style-src 'self' 'unsafe-inline'";
    const { handler } = fixture({ fetcher: mockFetch(async (url, init) => {
      target = String(url); incoming = new Headers(init?.headers);
      return new Response("<!doctype html><HEAD></HEAD><body>OpenCode</body>", {
        headers: { "Content-Type": "text/html", ETag: '"original"', "Content-Length": "999", "Content-Security-Policy": csp, "Set-Cookie": "sid=abc; HttpOnly" },
      });
    }) });
    const res = await handler(request("/project/session?x=1", { headers: { Authorization: "Basic encoded", "If-None-Match": '"original"', Range: "bytes=0-99" } }));
    expect(target).toBe("http://127.0.0.1:4096/project/session?x=1");
    expect(incoming.get("Authorization")).toBe("Basic encoded");
    expect(incoming.get("Host")).toBe("voice.example.test");
    expect(incoming.get("X-OCVD-Proxy-Token")).toBeNull();
    expect(incoming.get("If-None-Match")).toBeNull(); expect(incoming.get("Range")).toBeNull();
    expect(incoming.get("Accept-Encoding")).toBe("identity");
    expect(res.headers.get("Content-Security-Policy")).toBe(csp);
    expect(res.headers.get("Set-Cookie")).toBe("sid=abc; HttpOnly");
    expect(res.headers.get("ETag")).toBeNull(); expect(res.headers.get("Content-Length")).toBeNull();
    const text = await res.text(); expect(text.match(/id="ocvd-server-script"/g)?.length).toBe(1);
    expect(text).toContain('/voice/voice.js'); expect(text).not.toContain(KEY); expect(text).not.toContain(TOKEN);
  });
  test("handles absent head and leaves existing injection alone", async () => {
    for (const html of ["<div>shell</div>", '<head><script id="ocvd-server-script" src="/voice/voice.js" defer></script></head>']) {
      const { handler } = fixture({ fetcher: mockFetch(async () => new Response(html, { headers: { "Content-Type": "text/html" } })) });
      expect((await (await handler(request("/"))).text()).match(/id="ocvd-server-script"/g)?.length).toBe(1);
    }
  });
  test("cannot escape to a protocol-relative upstream hostname", async () => {
    const { handler } = fixture({ fetcher: mockFetch(async (url) => {
      expect(new URL(String(url)).hostname).toBe("127.0.0.1"); return new Response("ok");
    }) });
    expect((await handler(request("//evil.test/path"))).status).toBe(200);
  });
  test("passes through non-HTML/redirects without injecting; rejects upgrades", async () => {
    const { handler } = fixture({ fetcher: mockFetch(async () => new Response('{"data":1}', { headers: { "Content-Type": "application/json" } })) });
    expect(await (await handler(request("/project"))).text()).toBe('{"data":1}');
    expect((await handler(request("/", { headers: { Upgrade: "websocket" } }))).status).toBe(405);
    const { handler: redirect } = fixture({ fetcher: mockFetch(async () => new Response(null, { status: 302, headers: { Location: "/login" } })) });
    const res = await redirect(request("/")); expect(res.status).toBe(302); expect(res.headers.get("Location")).toBe("/login");
  });
});

test("streaming size limit cannot be bypassed without Content-Length", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); controller.close(); } });
  const req = new Request(ORIGIN, { method: "POST", body: stream });
  await expect(readLimitedBody(req, 7)).rejects.toThrow("too large");
});
test("real Bun HTTP service works on loopback with the same REST handler", async () => {
  const { handler } = fixture();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler, maxRequestBodySize: 1024 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/voice/config`, { headers: { "X-OCVD-Proxy-Token": TOKEN } });
    expect(res.status).toBe(200); expect((await res.json()).settings.model).toBe(DEFAULT_SETTINGS.model);
  } finally { await server.stop(true); }
});
test("browser bundle builds without GM APIs, SQLite, or a provider API key", async () => {
  const text = await (await buildBrowser()).text();
  expect(text.length).toBeGreaterThan(1000);
  for (const forbidden of ["GM_xmlhttpRequest", "GM_getValue", "bun:sqlite", "api.groq.com", KEY, TOKEN]) expect(text).not.toContain(forbidden);
});
