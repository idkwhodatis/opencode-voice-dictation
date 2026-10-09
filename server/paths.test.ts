import { expect, test } from "bun:test";
import { createPaths, internalPath, normalizeBasePath, normalizeProxyMode } from "./paths";
import { createService } from "./service";
import { openSettings } from "./settings";
import { buildAssets } from "./main";

for (const value of ["/", "/opencode/", "/apps/ai/opencode/", "/a-b/x.y_v~2"]) {
  test(`normalizes configured mount ${value}`, () => {
    const p = createPaths(value);
    expect(p.basePath).toBe(value.endsWith("/") ? value : `${value}/`);
    expect(p.voice("config")).toBe(`${p.basePath}voice/config`);
    expect(p.voice()).toBe(p.voiceBasePath);
  });
}
for (const value of [null, 2, "", "abc", "//evil/", "https://x/", "/a//b/", "/a/../b/", "/./", "/%2f/", "/%252f/", "/a?b", "/a#b", "/a\\b", "/a b", "/a\n", "/a\"/", "/a</"]) {
  test(`rejects unsafe mount ${JSON.stringify(value)}`, () => expect(() => normalizeBasePath(value)).toThrow());
}
test("URL suffixes and proxy modes cannot escape their namespace", () => {
  for (const suffix of ["../config", "/config", "//evil", "a?b", "a#b", "a%2fb"]) expect(() => createPaths().voice(suffix)).toThrow();
  expect(() => normalizeProxyMode("auto")).toThrow();
  expect(internalPath("/opencodex/voice/config", "/opencode/", "preserve")).toBeNull();
});
const assets = await buildAssets();
for (const basePath of ["/", "/opencode/", "/apps/ai/opencode/"]) for (const proxyMode of ["preserve", "strip"] as const) {
  test(`plugin namespace and guards ${basePath} ${proxyMode}`, async () => {
    const settings = openSettings(":memory:");
    const paths = createPaths(basePath);
    const token = "test-private-proxy-token-".repeat(3);
    let upstreamPath = "";
    const handler = createService({ origin: "https://example.test", basePath, proxyMode, proxyToken: token,
      upstream: "http://127.0.0.1:4096", settings, assets, fetcher: (async (input) => {
        upstreamPath = new URL(String(input)).pathname;
        return new Response('<html><head><script src="app.js"></script></head><body>app</body></html>', { headers: { "Content-Type": "text/html" } });
      }) as typeof fetch });
    const request = (suffix: string, init: RequestInit = {}) => {
      const path = proxyMode === "preserve" ? `${basePath}${suffix}` : `/${suffix}`;
      return handler(new Request(`https://example.test${path}`, { ...init, headers: { "X-OCVD-Proxy-Token": token,
        "X-Forwarded-Prefix": "/evil/", ...init.headers } }));
    };
    try {
      expect((await request("voice")).headers.get("Location")).toBe(paths.voice());
      const html = await (await request("voice/")).text();
      expect(html).toContain(`href="${paths.voice("settings.css")}"`);
      expect(html).toContain(`src="${paths.voice("settings.js")}"`);
      expect(html).toContain(`data-base-path="${basePath}"`);
      expect(html).toContain(`href="${basePath}"`);
      for (const route of ["voice.js", "settings.js", "settings.css", "config", "health", "sw.js"]) expect((await request(`voice/${route}`)).status).toBe(200);
      expect((await request("voice/sw.js")).headers.get("Service-Worker-Allowed")).toBe(basePath);
      expect((await request("voice/config", { method: "PATCH", headers: { Origin: "https://evil.test" } })).status).toBe(403);
      expect((await request("voice/config", { method: "PATCH" })).status).toBe(403);
      expect((await request("voice/missing")).status).toBe(404);
      const injected = await (await request("session/test")).text();
      expect(injected.indexOf(`src="${paths.voice("voice.js")}"`)).toBeLessThan(injected.indexOf('src="app.js"'));
      expect(injected).not.toContain("defer");
      expect(upstreamPath).toBe(proxyMode === "preserve" ? `${basePath}session/test` : "/session/test");
      if (basePath !== "/" && proxyMode === "preserve") expect((await handler(new Request("https://example.test/voice/config", { headers: { "X-OCVD-Proxy-Token": token } }))).status).toBe(404);
    } finally { settings.close(); }
  });
}

for (const [name, shell, skipped] of [
  ["meta policy precedes bootstrap", '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><script src="app.js"></script></head></html>', false],
  ["late meta policy fails closed", '<html><head><script src="app.js"></script><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"></head></html>', true],
  ["encoded late meta policy fails closed", '<html><head><script src="app.js"></script><meta http-equiv="content-security-pol&#105;cy" content="script-src \'none\'"></head></html>', true],
  ["headless scripts still follow bootstrap", '<html><body><script src="app.js"></script></body></html>', false],
] as const) test(name, async () => {
  const settings = openSettings(":memory:");
  const token = "test-proxy-token-".repeat(3);
  try {
    const handler = createService({ origin: "https://example.test", proxyToken: token,
      upstream: "http://127.0.0.1:4096", settings, assets,
      fetcher: (async (_input: string | URL | Request) => new Response(shell, { headers: { "Content-Type": "text/html", "Content-Security-Policy": "script-src 'self'" } })) as typeof fetch });
    const response = await handler(new Request("https://example.test/", { headers: { "X-OCVD-Proxy-Token": token } }));
    const body = await response.text();
    expect(response.headers.get("Content-Security-Policy")).toBe("script-src 'self'");
    if (skipped) {
      expect(body).toBe(shell);
      expect(response.headers.get("X-OCVD-Injection")).toBe("skipped-late-meta-csp");
    } else {
      expect(body.indexOf('id="ocvd-server-script"')).toBeLessThan(body.indexOf('src="app.js"'));
      if (shell.includes("<meta")) expect(body.indexOf('id="ocvd-server-script"')).toBeGreaterThan(body.indexOf("<meta"));
    }
  } finally { settings.close(); }
});

for (const policy of [
  '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">',
  '<META content="script-src \'none\'" HTTP-EQUIV="CONTENT-SECURITY-POLICY">',
]) test(`scriptless shell keeps bootstrap after policy ${policy}`, async () => {
  const settings = openSettings(":memory:");
  const token = "test-proxy-token-".repeat(3);
  try {
    const handler = createService({ origin: "https://example.test", proxyToken: token,
      upstream: "http://127.0.0.1:4096", settings, assets,
      fetcher: (async (_input: string | URL | Request) => new Response(`<html><head>${policy}</head><body>app</body></html>`, { headers: { "Content-Type": "text/html" } })) as typeof fetch });
    const body = await (await handler(new Request("https://example.test/", { headers: { "X-OCVD-Proxy-Token": token } }))).text();
    expect(body.indexOf('id="ocvd-server-script"')).toBeGreaterThan(body.toLowerCase().indexOf("<meta"));
    expect(body.indexOf('id="ocvd-server-script"')).toBeLessThan(body.indexOf("</head>"));
  } finally { settings.close(); }
});
