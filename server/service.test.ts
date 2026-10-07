import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createService, readLimitedBody, type ServiceOptions } from "./service";
import { DEFAULT_RUNTIME_LIMITS, DEFAULT_SETTINGS, openSettings, validatePatch, type RuntimeLimits } from "./settings";
import { openProviderStore } from "./provider";
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
  const ranges: [keyof RuntimeLimits, number][] = [
    ["maxAudioMB", 100], ["maxRecordingSeconds", 3600], ["timeoutSeconds", 300],
    ["maxConcurrent", 16], ["requestsPerMinute", 1000],
  ];
  test.each(ranges)("validates %s as a bounded strict integer", (key, maximum) => {
    for (const value of [1, maximum]) expect(validatePatch({ [key]: value })).toEqual({ [key]: value });
    for (const value of [0, -1, maximum + 1, 1.5, "1", "", true, null, NaN, Infinity, -Infinity, undefined]) {
      expect(() => validatePatch({ [key]: value })).toThrow(`${key} must be an integer`);
    }
  });
  test("all runtime limits and preferences update atomically", () => {
    const { settings } = fixture();
    const next = { maxAudioMB: 30, maxRecordingSeconds: 400, timeoutSeconds: 70, maxConcurrent: 3, requestsPerMinute: 20 };
    settings.patch({ ...next, language: "zh", whisperPrompt: "Keep this prompt", autoSubmit: true });
    expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS, ...next, language: "zh", whisperPrompt: "Keep this prompt", autoSubmit: true });
    expect(() => settings.patch({ model: "changed", maxAudioMB: 40, maxConcurrent: 1.5 })).toThrow();
    expect(settings.get().model).toBe(DEFAULT_SETTINGS.model);
    expect(settings.get().maxAudioMB).toBe(30);
    settings.patch({ timeoutSeconds: 90 });
    expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS, ...next, timeoutSeconds: 90, language: "zh", whisperPrompt: "Keep this prompt", autoSubmit: true });
  });
  test("migration seeds only missing limits and preserves preferences and encrypted credentials on restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ocvd-limits-migration-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "settings.sqlite");
    const legacy = { model: "legacy-model", language: "zh", whisperPrompt: "Legacy prompt", temperature: 0.3, autoSubmit: true, maxAudioMB: 7 };
    const db = new Database(path);
    cleanup.push(() => db.close());
    db.run("CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)");
    db.query("INSERT INTO settings (id, value) VALUES (1, ?)").run(JSON.stringify(legacy));
    db.run("PRAGMA user_version = 1");
    const provider = openProviderStore(path, join(dir, "master.key"));
    cleanup.push(() => provider.close());
    provider.save({ provider: "groq", apiKey: KEY });
    const encrypted = db.query("SELECT * FROM provider_credentials").get();
    let store = openSettings(path, { maxAudioMB: 80, maxRecordingSeconds: 900, timeoutSeconds: 25, maxConcurrent: 5 });
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, ...legacy, maxRecordingSeconds: 900, timeoutSeconds: 25, maxConcurrent: 5 });
    store.patch({ maxAudioMB: 8, requestsPerMinute: 44, timeoutSeconds: 35 });
    const saved = store.get();
    store.close();
    store = openSettings(path, { maxAudioMB: 90, maxRecordingSeconds: 1000, timeoutSeconds: 10, maxConcurrent: 1, requestsPerMinute: 1 });
    cleanup.push(() => store.close());
    expect(store.get()).toEqual(saved);
    expect(JSON.parse(db.query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1").get()!.value)).toEqual(saved);
    expect(db.query("SELECT * FROM provider_credentials").get()).toEqual(encrypted);
    expect((await provider.getCredentials()).apiKey).toBe(KEY);
  });
  test("fresh settings persist initial limits and fill any unseeded limits from defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocvd-limits-new-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "settings.sqlite");
    const store = openSettings(path, { maxConcurrent: 6 });
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, ...DEFAULT_RUNTIME_LIMITS, maxConcurrent: 6 });
    store.close();
    const reopened = openSettings(path, { maxConcurrent: 12, maxAudioMB: 90 });
    cleanup.push(() => reopened.close());
    expect(reopened.get()).toEqual({ ...DEFAULT_SETTINGS, maxConcurrent: 6 });
  });
  test("failed migration leaves the original row and schema version untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocvd-limits-corrupt-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "settings.sqlite");
    const db = new Database(path);
    cleanup.push(() => db.close());
    db.run("CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)");
    const corrupt = JSON.stringify({ model: "keep-this", maxConcurrent: "2" });
    db.query("INSERT INTO settings (id, value) VALUES (1, ?)").run(corrupt);
    expect(() => openSettings(path, { maxAudioMB: 30 })).toThrow("maxConcurrent must be an integer");
    expect(db.query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1").get()!.value).toBe(corrupt);
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(0);
    expect(() => openSettings(":memory:", { maxConcurrent: 0 })).toThrow("maxConcurrent must be an integer");
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
  test("live runtime limit PATCH updates GET and browser limits without restarting", async () => {
    const { handler } = fixture();
    const before = await (await handler(request("/voice/config"))).json();
    expect(before.maxAudioBytes).toBe(20 * 1024 * 1024);
    expect(before.maxRecordingSeconds).toBe(300);
    const patch = { maxAudioMB: 9, maxRecordingSeconds: 120, timeoutSeconds: 15, maxConcurrent: 4, requestsPerMinute: 25 };
    const response = await handler(request("/voice/config", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    }));
    expect(response.status).toBe(200);
    const changed = await response.json();
    expect(changed.settings).toEqual({ ...DEFAULT_SETTINGS, ...patch });
    expect(changed.maxAudioBytes).toBe(9 * 1024 * 1024);
    expect(changed.maxRecordingSeconds).toBe(120);
    expect(await (await handler(request("/voice/config"))).json()).toEqual(changed);
  });
  test("limit patches retain authentication and CSRF guards and reject invalid updates atomically", async () => {
    const { handler, settings } = fixture();
    const update = (value: unknown, headers: Record<string, string> = {}) => request("/voice/config", {
      method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value),
    });
    for (const [headers, status] of [
      [{ "X-OCVD-Proxy-Token": "" }, 401], [{ Origin: "https://evil.test" }, 403],
      [{ "Sec-Fetch-Site": "same-site" }, 403], [{ "X-OCVD-Request": "" }, 403],
      [{ "Content-Type": "text/plain" }, 415],
    ] as [Record<string, string>, number][]) {
      expect((await handler(update({ maxConcurrent: 8 }, headers))).status).toBe(status);
    }
    for (const invalid of ["2", 2.5, 0, 17, null]) {
      expect((await handler(update({ model: "changed", maxAudioMB: 99, maxConcurrent: invalid }))).status).toBe(400);
    }
    for (const field of ["apiKey", "endpoint", "host", "port", "dbPath", "encryptionKeyFile"]) {
      expect((await handler(update({ maxAudioMB: 99, [field]: "forbidden" }))).status).toBe(400);
    }
    expect(settings.get()).toEqual(DEFAULT_SETTINGS);
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
  test("snapshots audio limit, model, and preferences at admission before credentials await", async () => {
    let releaseKey!: (value: string) => void;
    let keyStarted!: () => void;
    const keyReady = new Promise<void>((resolve) => { keyStarted = resolve; });
    const pendingKey = new Promise<string>((resolve) => { releaseKey = resolve; });
    const calls: FormData[] = [];
    const { handler, settings } = fixture({
      getApiKey: async () => { keyStarted(); return pendingKey; },
      fetcher: mockFetch(async (_, init) => { calls.push(init!.body as FormData); return Response.json({ text: "hello" }); }),
    });
    settings.patch({ maxAudioMB: 2, model: "old-model", language: "zh", whisperPrompt: "old prompt", temperature: 0.1 });
    const audio = new Uint8Array(1024 * 1024 + 1);
    const first = handler(recording({ body: audio }));
    await keyReady;
    settings.patch({ maxAudioMB: 1, model: "new-model", language: "en", whisperPrompt: "new prompt", temperature: 0.9, autoSubmit: true });
    releaseKey(KEY);
    const accepted = await first;
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ text: "hello", autoSubmit: false });
    expect(calls[0].get("model")).toBe("old-model");
    expect(calls[0].get("language")).toBe("zh");
    expect(calls[0].get("prompt")).toBe("old prompt");
    expect(calls[0].get("temperature")).toBe("0.1");
    expect((await handler(recording({ body: audio }))).status).toBe(413);
    expect(calls.length).toBe(1);
    expect(await (await handler(recording())).json()).toEqual({ text: "hello", autoSubmit: true });
    expect(calls[1].get("model")).toBe("new-model");
    expect(calls[1].get("language")).toBe("en");
    expect(calls[1].get("prompt")).toBe("new prompt");
    expect(calls[1].get("temperature")).toBe("0.9");
  });
  test("live audio size limits reject oversized streams and allow increased limits", async () => {
    let calls = 0;
    const { handler, settings } = fixture({ fetcher: mockFetch(async () => { calls++; return Response.json({ text: "hello" }); }) });
    settings.patch({ maxAudioMB: 1 });
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close();
    } });
    expect((await handler(recording({ body: stream }))).status).toBe(413);
    expect(calls).toBe(0);
    settings.patch({ maxAudioMB: 2 });
    expect((await handler(recording({ body: new Uint8Array(1024 * 1024 + 1) }))).status).toBe(200);
    expect(calls).toBe(1);
  });
  test("lowering concurrency preserves active calls and blocks new ones until below the cap", async () => {
    const releases: ((response: Response) => void)[] = [];
    const signals: AbortSignal[] = [];
    let started!: () => void;
    let ready = new Promise<void>((resolve) => { started = resolve; });
    const { handler, settings } = fixture({ fetcher: mockFetch(async (_, init) => {
      signals.push(init!.signal!);
      return new Promise<Response>((resolve) => { releases.push(resolve); started(); });
    }) });
    settings.patch({ maxConcurrent: 2 });
    const first = handler(recording()); await ready;
    ready = new Promise<void>((resolve) => { started = resolve; });
    const second = handler(recording()); await ready;
    settings.patch({ maxConcurrent: 1 });
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    expect((await handler(recording())).status).toBe(429);
    releases[0](Response.json({ text: "first" }));
    expect((await first).status).toBe(200);
    expect((await handler(recording())).status).toBe(429);
    releases[1](Response.json({ text: "second" }));
    expect((await second).status).toBe(200);
    ready = new Promise<void>((resolve) => { started = resolve; });
    const third = handler(recording()); await ready;
    releases[2](Response.json({ text: "third" }));
    expect((await third).status).toBe(200);
  });
  test("raising concurrency admits another call while one remains active", async () => {
    const releases: ((response: Response) => void)[] = [];
    let started!: () => void;
    let ready = new Promise<void>((resolve) => { started = resolve; });
    const { handler, settings } = fixture({ fetcher: mockFetch(async () => new Promise<Response>((resolve) => {
      releases.push(resolve); started();
    })) });
    settings.patch({ maxConcurrent: 1 });
    const first = handler(recording()); await ready;
    expect((await handler(recording())).status).toBe(429);
    settings.patch({ maxConcurrent: 2 });
    ready = new Promise<void>((resolve) => { started = resolve; });
    const second = handler(recording()); await ready;
    for (const release of releases) release(Response.json({ text: "ok" }));
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });
  test("live rate updates preserve the existing starts window", async () => {
    const { handler, settings } = fixture();
    settings.patch({ requestsPerMinute: 2 });
    expect((await handler(recording())).status).toBe(200);
    expect((await handler(recording())).status).toBe(200);
    settings.patch({ requestsPerMinute: 1 });
    expect((await handler(recording())).status).toBe(429);
    settings.patch({ requestsPerMinute: 3 });
    expect((await handler(recording())).status).toBe(200);
    expect((await handler(recording())).status).toBe(429);
    settings.patch({ whisperPrompt: "Unrelated change", requestsPerMinute: 3 });
    expect((await handler(recording())).status).toBe(429);
  });
  test("new provider calls use the updated timeout while active calls keep their snapshot", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let releaseFirst!: (response: Response) => void;
    let firstSignal!: AbortSignal;
    let count = 0;
    const { handler, settings } = fixture({ fetcher: mockFetch(async (_, init) => new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      if (++count === 1) { firstSignal = signal; releaseFirst = resolve; started(); }
    })) });
    settings.patch({ timeoutSeconds: 4 });
    const first = handler(recording()); await ready;
    settings.patch({ timeoutSeconds: 1 });
    expect((await handler(recording())).status).toBe(504);
    expect(firstSignal.aborted).toBe(false);
    releaseFirst(Response.json({ text: "first completes" }));
    expect((await first).status).toBe(200);
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


describe("write-only provider settings", () => {
  function providerFixture() {
    const dir = mkdtempSync(join(tmpdir(), "ocvd-provider-http-"));
    const provider = openProviderStore(join(dir, "settings.sqlite"), join(dir, "keys/master.key"));
    cleanup.push(() => { provider.close(); rmSync(dir, { recursive: true, force: true }); });
    let destination = "";
    let authorization = "";
    const { handler } = fixture({ provider, fetcher: mockFetch(async (input, init) => {
      destination = String(input); authorization = new Headers(init?.headers).get("Authorization") ?? "";
      expect(init?.redirect).toBe("error");
      return Response.json({ text: "safe transcript" });
    }) });
    return { handler, provider, sent: () => ({ destination, authorization }) };
  }
  const update = (body: unknown, headers: Record<string, string> = {}) => request("/voice/provider", {
    method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  test("auth, origin, CSRF marker, method and content type guard credential updates", async () => {
    const { handler, provider } = providerFixture();
    const value = { provider: "groq", apiKey: KEY };
    for (const [headers, expected] of [
      [{ "X-OCVD-Proxy-Token": "" }, 401], [{ Origin: "https://evil.test" }, 403],
      [{ "sec-fetch-site": "same-site" }, 403], [{ "X-OCVD-Request": "" }, 403],
      [{ "Content-Type": "text/plain" }, 415],
    ] as [Record<string, string>, number][]) expect((await handler(update(value, headers))).status).toBe(expected);
    expect((await handler(request("/voice/provider", { method: "POST" }))).status).toBe(405);
    expect((await provider.getStatus()).apiKeyConfigured).toBe(false);
  });
  test("key is write-only and target changes never reuse the old credential", async () => {
    const { handler, sent } = providerFixture();
    expect((await handler(update({ provider: "groq", apiKey: KEY }))).status).toBe(200);
    for (const path of ["/voice/config", "/voice/provider"]) {
      const response = await handler(request(path));
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain(KEY);
    }
    expect((await handler(update({ provider: "custom", endpoint: "https://custom.example.test/stt" }))).status).toBe(400);
    await handler(recording());
    expect(sent()).toEqual({ destination: "https://api.groq.com/openai/v1/audio/transcriptions", authorization: `Bearer ${KEY}` });
    expect((await handler(update({ provider: "custom", endpoint: "https://custom.example.test/stt", apiKey: "dummy-custom-key" }))).status).toBe(200);
    await handler(recording());
    expect(sent()).toEqual({ destination: "https://custom.example.test/stt", authorization: "Bearer dummy-custom-key" });
    expect((await handler(update({ provider: "custom", endpoint: "https://custom.example.test/stt", apiKey: null }))).status).toBe(200);
    expect((await handler(recording())).status).toBe(503);
  });
  test("malformed and oversized credential updates are bounded and do not echo secrets", async () => {
    const { handler } = providerFixture();
    const result = await handler(update({ provider: "custom", endpoint: `https://user:${KEY}@example.test/stt`, apiKey: KEY }));
    expect(result.status).toBe(400); expect(await result.text()).not.toContain(KEY);
    expect((await handler(update({ provider: "groq", apiKey: "a".repeat(17000) }))).status).toBe(413);
    expect((await handler(new Request(`${ORIGIN}/voice/provider`, { method: "GET" }))).status).toBe(401);
  });
});
