import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createPaths } from "./paths";
import { installVoiceWorker } from "./registration";

const origin = "https://voice.example.test";
function registration(scope: string, active: string | null, waiting: string | null = null) {
  return {
    scope: new URL(scope, origin).href,
    active: active ? { scriptURL: new URL(active, origin).href } : null,
    waiting: waiting ? { scriptURL: new URL(waiting, origin).href } : null,
    installing: null,
  } as ServiceWorkerRegistration;
}
function fixture(basePath: string, registrations: ServiceWorkerRegistration[] = []) {
  const calls: { script: string | URL; options?: RegistrationOptions }[] = [];
  const serviceWorker = {
    async getRegistrations() { return registrations; },
    async register(script: string | URL, options?: RegistrationOptions) {
      expect(this).toBe(serviceWorker);
      calls.push({ script, options });
      return registration(basePath, String(script));
    },
  } as unknown as ServiceWorkerContainer;
  let baseURI = `${origin}${basePath}project/session`;
  return {
    calls, serviceWorker,
    setBaseURI(value: string) { baseURI = value; },
    install() {
      return installVoiceWorker(createPaths(basePath), {
        serviceWorker, documentURL: `${origin}${basePath}project/session`, baseURI: () => baseURI,
      });
    },
  };
}

describe("app-scoped worker registration", () => {
  for (const base of ["/", "/apps/opencode/"]) {
    test(`uses the voice namespace and exact public scope for ${base}`, async () => {
      const f = fixture(base);
      await f.install();
      expect(f.calls).toEqual([{
        script: `${origin}${base}voice/sw.js`,
        options: { scope: `${origin}${base}`, updateViaCache: "none" },
      }]);
    });
    test(`interposes synchronously before the original ${base}sw.js call`, async () => {
      const f = fixture(base);
      const installed = f.install();
      const app = f.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: "all", type: "module" });
      await Promise.all([installed, app]);
      expect(f.calls.map((call) => call.script)).toEqual([
        `${origin}${base}voice/sw.js`, `${origin}${base}voice/sw.js`,
      ]);
      expect(f.calls[1].options).toEqual({ scope: `${origin}${base}`, updateViaCache: "none", type: "module" });
    });
    test(`adapts default and document-base-relative scopes for ${base}`, async () => {
      const f = fixture(base);
      await f.install();
      f.setBaseURI(`${origin}${base}`);
      await f.serviceWorker.register("./sw.js");
      await f.serviceWorker.register(new URL("sw.js", `${origin}${base}`), { scope: "./" });
      expect(f.calls.every((call) => call.script === `${origin}${base}voice/sw.js`)).toBe(true);
    });
  }

  test("passes other app, nested, query-qualified, and cross-origin registrations through unchanged", async () => {
    const f = fixture("/apps/opencode/");
    await f.install();
    const calls = [
      { script: "/apps/other/sw.js", options: { scope: "/apps/other/" } },
      { script: "/apps/opencode/sw.js", options: { scope: "/apps/opencode/nested/" } },
      { script: "/apps/opencode/other.js", options: { scope: "/apps/opencode/" } },
      { script: "/apps/opencode/sw.js?other-app=1", options: { scope: "/apps/opencode/" } },
      { script: "https://other.example.test/apps/opencode/sw.js", options: { scope: "/apps/opencode/" } },
    ];
    for (const call of calls) await f.serviceWorker.register(call.script, call.options);
    expect(f.calls.slice(1)).toEqual(calls);
    for (let i = 0; i < calls.length; i++) expect(f.calls[i + 1].options).toBe(calls[i].options);
  });

  test("redirects a stock root registration call without modifying an existing root registration", async () => {
    const root = registration("/", "/sw.js");
    const f = fixture("/apps/opencode/", [root]);
    await f.install();
    await f.serviceWorker.register("/sw.js", { scope: "/" });
    await f.serviceWorker.register("/sw.js");
    expect(f.calls).toHaveLength(3);
    for (const call of f.calls) {
      expect(call).toEqual({
        script: `${origin}/apps/opencode/voice/sw.js`,
        options: { scope: `${origin}/apps/opencode/`, updateViaCache: "none" },
      });
    }
    expect(root.scope).toBe(`${origin}/`);
    expect(root.active!.scriptURL).toBe(`${origin}/sw.js`);
  });

  test("migrates only the exact app's legacy worker while leaving other scopes untouched", async () => {
    const f = fixture("/apps/opencode/", [
      registration("/", "/sw.js"),
      registration("/apps/other/", "/apps/other/sw.js"),
      registration("/apps/opencode/nested/", "/apps/opencode/nested/sw.js"),
      registration("/apps/opencode/", "/apps/opencode/sw.js"),
    ]);
    await f.install();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].script).toBe(`${origin}/apps/opencode/voice/sw.js`);
  });

  test("updates its own worker at the exact app scope", async () => {
    const f = fixture("/apps/opencode/", [registration("/apps/opencode/", "/apps/opencode/voice/sw.js")]);
    await f.install();
    expect(f.calls).toHaveLength(1);
  });

  for (const [active, waiting] of [
    ["/other-worker.js", null],
    ["/apps/opencode/sw.js", "/other-worker.js"],
    [null, null],
  ]) {
    test(`does not replace a scope with an unknown worker (${active}, ${waiting})`, async () => {
      const f = fixture("/apps/opencode/", [registration("/apps/opencode/", active, waiting)]);
      await expect(f.install()).rejects.toThrow("another service worker owns");
      await expect(f.serviceWorker.register("/apps/opencode/sw.js")).rejects.toThrow("another service worker owns");
      expect(f.calls).toHaveLength(0);
    });
  }

  test("does nothing when service workers are unavailable or the document is outside this app", async () => {
    await expect(installVoiceWorker(createPaths("/"), {
      documentURL: `${origin}/`, baseURI: () => `${origin}/`,
    })).resolves.toBeUndefined();
    const f = fixture("/apps/opencode/");
    const native = f.serviceWorker.register;
    await installVoiceWorker(createPaths("/apps/opencode/"), {
      serviceWorker: f.serviceWorker, documentURL: `${origin}/apps/opencode-other/`, baseURI: () => origin,
    });
    expect(f.serviceWorker.register).toBe(native);
    expect(f.calls).toHaveLength(0);
  });
});

describe("network-only worker migration", () => {
  const source = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  for (const scope of [`${origin}/`, `${origin}/apps/opencode/`]) {
    test(`cleans only the exact Workbox precache for ${scope}`, async () => {
      const listeners = new Map<string, (event: { waitUntil(promise: Promise<void>): void }) => void>();
      const cacheNames = new Set([
        `workbox-precache-v2-${scope}`,
        `workbox-precache-v2-${origin}/apps/other/`,
        `workbox-precache-v2-${scope}nested/`,
        `workbox-precache-v2-${scope}-custom`,
        "workbox-precache-v2", "unrelated-app-cache", "custom-opencode-cache",
      ]);
      const before = [...cacheNames];
      let skipped = false;
      let claimed = false;
      runInNewContext(source, { self: {
        registration: { scope },
        addEventListener: (name: string, callback: typeof listeners extends Map<string, infer T> ? T : never) => listeners.set(name, callback),
        skipWaiting: async () => { skipped = true; },
        caches: { delete: async (name: string) => cacheNames.delete(name) },
        clients: { claim: async () => { claimed = true; } },
      } });
      expect([...listeners.keys()]).toEqual(["install", "activate"]);
      listeners.get("install")!({ waitUntil() {} });
      let activation: Promise<void> | undefined;
      listeners.get("activate")!({ waitUntil(promise) { activation = promise; } });
      await activation;
      expect(skipped).toBe(true);
      expect(claimed).toBe(true);
      expect([...cacheNames]).toEqual(before.filter((name) => name !== `workbox-precache-v2-${scope}`));
    });
  }

  test("claims clients even if browser cache storage is unavailable", async () => {
    let activate!: (event: { waitUntil(promise: Promise<void>): void }) => void;
    let claimed = false;
    runInNewContext(source, { self: {
      registration: { scope: `${origin}/apps/opencode/` },
      addEventListener: (name: string, callback: typeof activate) => { if (name === "activate") activate = callback; },
      caches: { delete: async () => { throw new Error("Storage disabled"); } },
      clients: { claim: async () => { claimed = true; } },
    } });
    let activation: Promise<void> | undefined;
    activate({ waitUntil(promise) { activation = promise; } });
    await activation;
    expect(claimed).toBe(true);
  });
});
