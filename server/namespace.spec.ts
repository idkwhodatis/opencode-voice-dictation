import { expect, test, type Page, type TestInfo } from "@playwright/test";

interface Mount {
  basePath: string;
  proxyMode: "preserve" | "strip";
}
interface FixtureState extends Mount {
  requests: { method: string; publicPath: string; servicePath: string }[];
  upstreamPaths: string[];
  providerCalls: number;
  lastModel: string;
  lastAudioBytes: number;
}
function mount(info: TestInfo): Mount {
  return info.project.metadata as Mount;
}
async function expectVoiceControl(page: Page, basePath: string) {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toBe(new URL(`${basePath}voice/sw.js`, page.url()).href);
  const registration = await page.evaluate(async (base) => {
    const entry = await navigator.serviceWorker.getRegistration(base);
    return { scope: entry?.scope, script: entry?.active?.scriptURL };
  }, basePath);
  expect(registration).toEqual({
    scope: new URL(basePath, page.url()).href,
    script: new URL(`${basePath}voice/sw.js`, page.url()).href,
  });
}
async function seedWorkers(page: Page, basePath: string, legacy = false) {
  await page.goto("/__namespace/seed");
  await page.evaluate(
    async ({ basePath, legacy }) => {
      async function install(script: string, scope: string) {
        const registration = await navigator.serviceWorker.register(script, {
          scope,
          updateViaCache: "none",
        });
        if (registration.active?.state === "activated") return;
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (!worker) throw new Error(`No worker for ${script}`);
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            if (worker.state === "activated") resolve();
            if (worker.state === "redundant")
              reject(new Error(`Worker became redundant: ${script}`));
          };
          worker.addEventListener("statechange", check);
          check();
        });
      }
      await install("/other/sw.js", "/other/");
      if (basePath !== "/") await install("/site-sw.js", "/");
      const unrelated = await caches.open("unrelated-app-cache");
      await unrelated.put("/other/keep", new Response("unrelated payload"));
      // Even a Workbox-looking cache must not be broadly erased by a voice install.
      const workboxOther = await caches.open("workbox-precache-v2-unrelated-app");
      await workboxOther.put("/other/workbox-keep", new Response("unrelated workbox payload"));
      if (legacy) await install(`${basePath}sw.js`, basePath);
    },
    { basePath, legacy },
  );
}
async function expectUnrelatedUntouched(page: Page, basePath: string) {
  const values = await page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations())
      .map((entry) => ({
        scope: new URL(entry.scope).pathname,
        script: entry.active ? new URL(entry.active.scriptURL).pathname : null,
      }))
      .sort((a, b) => a.scope.localeCompare(b.scope)),
    cache: await (await caches.open("unrelated-app-cache"))
      .match("/other/keep")
      .then((value) => value?.text()),
    workboxCache: await (await caches.open("workbox-precache-v2-unrelated-app"))
      .match("/other/workbox-keep")
      .then((value) => value?.text()),
  }));
  const registrations = [
    { scope: "/other/", script: "/other/sw.js" },
    { scope: basePath, script: `${basePath}voice/sw.js` },
  ];
  if (basePath !== "/") registrations.push({ scope: "/", script: "/site-sw.js" });
  expect(values.registrations).toEqual(
    registrations.sort((a, b) => a.scope.localeCompare(b.scope)),
  );
  expect(values.cache).toBe("unrelated payload");
  expect(values.workboxCache).toBe("unrelated workbox payload");
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/__namespace/reset");
  await page.addInitScript(() => {
    // Chromium still runs its real MediaRecorder and the actual voice upload path.
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const source = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        source.connect(destination);
        source.start();
        await context.resume();
        return destination.stream;
      },
    });
  });
});

test("upstream meta CSP blocks the injected bootstrap before it can initialize or register a worker", async ({
  page,
  request,
}, info) => {
  const { basePath } = mount(info);
  await request.post("/__namespace/deployment", { data: { enabled: true, blockScripts: true } });
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { namespaceCspViolations: violations });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(event.effectiveDirective);
    });
  });
  await page.goto(`${basePath}project/session`);
  await expect(page.locator("#network-shell")).toBeVisible();
  await expect(page.locator("#ocvd-server-script")).toHaveAttribute(
    "src",
    `${basePath}voice/voice.js`,
  );
  expect(
    await page.evaluate(() => {
      const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const bootstrap = document.querySelector("#ocvd-server-script");
      return (
        !!policy &&
        !!bootstrap &&
        !!(policy.compareDocumentPosition(bootstrap) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        "window.namespaceCspViolations.some(directive => directive === 'script-src' || directive === 'script-src-elem')",
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(async () => ({
      initialized: document.documentElement.hasAttribute("data-ocvd-initialized"),
      appStarted: "appRegistrationStarted" in window,
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      controlled: navigator.serviceWorker.controller !== null,
    })),
  ).toEqual({ initialized: false, appStarted: false, registrations: 0, controlled: false });
  await expect(page.locator(".ocvd-btn")).toHaveCount(0);
  const state = (await (await request.get("/__namespace/state")).json()) as FixtureState;
  expect(state.requests.some((entry) => entry.publicPath === `${basePath}voice/sw.js`)).toBe(false);
});

test("all settings, assets, links, and dictation requests stay inside the public mount", async ({
  page,
  request,
}, info) => {
  const { basePath, proxyMode } = mount(info);
  const voice = `${basePath}voice/`;
  const redirect = await request.get(voice.slice(0, -1), { maxRedirects: 0 });
  expect(redirect.status()).toBe(308);
  expect(redirect.headers().location).toBe(voice);
  const responses: { path: string; status: number; type: string }[] = [];
  page.on("response", (response) =>
    responses.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      type: response.headers()["content-type"] ?? "",
    }),
  );
  await page.goto(voice.slice(0, -1));
  await expect(page).toHaveURL(new URL(voice, page.url()).href);
  await expect(page.locator("#model")).toBeEnabled();
  await expect(page.locator("#provider")).toBeEnabled();
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute(
    "href",
    `${voice}settings.css`,
  );
  await expect(page.locator('script[src$="settings.js"]')).toHaveAttribute(
    "src",
    `${voice}settings.js`,
  );
  await expect(page.getByRole("link", { name: "← OpenCode" })).toHaveAttribute("href", basePath);
  expect(await page.locator("main").evaluate((element) => getComputedStyle(element).maxWidth)).toBe(
    "600px",
  );
  await page.locator("#model").fill("namespace-test-model");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("Settings saved.");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toHaveText("Provider settings saved.");
  await page.getByRole("link", { name: "← OpenCode" }).click();
  await expect(page).toHaveURL(new URL(basePath, page.url()).href);
  await expect(page.locator("#network-shell")).toBeVisible();
  await expect(page.locator(".ocvd-settings")).toHaveAttribute("href", voice);
  await expect(page.locator("#ocvd-server-script")).toHaveAttribute("src", `${voice}voice.js`);
  await expectVoiceControl(page, basePath);
  await page.getByRole("button", { name: "Voice Dictation (Ctrl+Space)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop and review", exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Stop and review", exact: true }).click();
  await expect(page.locator('[data-component="composer-editor"]')).toContainText(
    "Mounted voice transcript",
  );
  expect(await page.evaluate("window.sendCount")).toBe(0);

  const state = (await (await request.get("/__namespace/state")).json()) as FixtureState;
  expect(state.providerCalls).toBe(1);
  expect(state.lastModel).toBe("namespace-test-model");
  expect(state.lastAudioBytes).toBeGreaterThan(0);
  for (const name of [
    "settings.css",
    "settings.js",
    "config",
    "provider",
    "voice.js",
    "sw.js",
    "transcribe",
  ]) {
    expect(
      state.requests.some((entry) => entry.publicPath === `${voice}${name}`),
      name,
    ).toBe(true);
  }
  expect(state.requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: "PATCH", publicPath: `${voice}config` }),
      expect.objectContaining({ method: "PUT", publicPath: `${voice}provider` }),
    ]),
  );
  for (const entry of state.requests) {
    expect(entry.publicPath.startsWith(basePath)).toBe(true);
    expect(entry.servicePath).toBe(
      proxyMode === "strip" ? entry.publicPath.slice(basePath.length - 1) : entry.publicPath,
    );
  }
  expect(responses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: `${voice}settings.css`,
        status: 200,
        type: expect.stringContaining("text/css"),
      }),
      expect.objectContaining({
        path: `${voice}settings.js`,
        status: 200,
        type: expect.stringContaining("javascript"),
      }),
      expect.objectContaining({
        path: `${voice}transcribe`,
        status: 200,
        type: expect.stringContaining("application/json"),
      }),
    ]),
  );
  expect(
    responses
      .filter((response) => response.path.includes("/voice/"))
      .every((response) => response.path.startsWith(voice)),
  ).toBe(true);
});

test("the real scoped worker wins app registration and leaves other workers and caches intact", async ({
  page,
  request,
}, info) => {
  const { basePath } = mount(info);
  await seedWorkers(page, basePath);
  await page.goto(`${basePath}project/session`);
  await expectVoiceControl(page, basePath);
  expect(await page.evaluate("window.appRegistrationStarted")).toBe(true);
  // This inline app script executes during parsing, immediately after the injected bootstrap.
  const appRegistration = (await page.evaluate("window.appRegistrationResult")) as {
    scope?: string;
    script?: string;
    error?: string;
  };
  expect(appRegistration.error).toBeUndefined();
  expect(appRegistration.scope).toBe(new URL(basePath, page.url()).href);
  expect(appRegistration.script).toBe(new URL(`${basePath}voice/sw.js`, page.url()).href);
  const stockRegistration = (await page.evaluate("window.stockRegistrationResult")) as {
    scope?: string;
    script?: string;
    error?: string;
  };
  expect(stockRegistration.error).toBeUndefined();
  expect(stockRegistration.scope).toBe(new URL(basePath, page.url()).href);
  expect(stockRegistration.script).toBe(new URL(`${basePath}voice/sw.js`, page.url()).href);
  await expectUnrelatedUntouched(page, basePath);
  const worker = await request.get(`${basePath}voice/sw.js`);
  expect(worker.status()).toBe(200);
  expect(worker.headers()["service-worker-allowed"]).toBe(basePath);
  expect(worker.headers()["content-type"]).toContain("javascript");
  expect(worker.headers()["cache-control"]).toContain("no-store");
  const probe = await page.evaluate(async (base) => {
    const cache = await caches.open("voice-must-not-serve-cached-navigation");
    await cache.put(`${base}__network-probe`, new Response("stale cached result"));
    return (await fetch(`${base}__network-probe`)).text();
  }, basePath);
  expect(probe).toBe("network-probe");
  await page.goto(`${basePath}voice/`);
  await expect(page.getByRole("heading", { name: "Voice settings", exact: true })).toBeVisible();
  await expect(page.locator("#model")).toBeEnabled();
  await expectVoiceControl(page, basePath);
  await expectUnrelatedUntouched(page, basePath);
});

test("a network-reaching legacy Workbox-style worker is replaced at only the exact app scope", async ({
  page,
  request,
}, info) => {
  const { basePath } = mount(info);
  await request.post("/__namespace/deployment", {
    data: { enabled: false, legacyMode: "network" },
  });
  await seedWorkers(page, basePath, true);
  await page.goto(`${basePath}project/session`);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toBe(new URL(`${basePath}sw.js`, page.url()).href);
  await expect(page.locator("#ocvd-server-script")).toHaveCount(0);
  await request.post("/__namespace/deployment", { data: { enabled: true } });
  await page.reload();
  await expect(page.locator(".ocvd-btn")).toHaveCount(1);
  await expectVoiceControl(page, basePath);
  await expectUnrelatedUntouched(page, basePath);
  // Only the exact default app Workbox cache is removed. Do not open it here:
  // caches.open would recreate it and conceal whether cleanup actually happened.
  const cacheState = await page.evaluate(async (base) => {
    const name = `workbox-precache-v2-${location.origin}${base}`;
    const keys = await caches.keys();
    const shell = await caches.match(`${base}index.html`, { cacheName: name });
    return { name, keys, present: keys.includes(name), shell: shell ? await shell.text() : null };
  }, basePath);
  if (cacheState.present) {
    // Read-only diagnostics distinguish failed cleanup from an old worker opening
    // the now-empty cache again. Never caches.open/delete here or change production.
    const workers = await Promise.all(
      page
        .context()
        .serviceWorkers()
        .map(async (worker) => {
          try {
            return await worker.evaluate(async () => {
              const scope = globalThis as unknown as {
                location: { href: string };
                registration: {
                  scope: string;
                  active: ServiceWorker | null;
                  installing: ServiceWorker | null;
                  waiting: ServiceWorker | null;
                };
                caches?: CacheStorage;
              };
              const registration = scope.registration;
              const cacheName = `workbox-precache-v2-${registration.scope}`;
              const cachedShell = await scope.caches?.match(
                new URL("index.html", registration.scope).href,
                { cacheName },
              );
              return {
                scriptURL: scope.location.href,
                scope: registration.scope,
                active: registration.active
                  ? { scriptURL: registration.active.scriptURL, state: registration.active.state }
                  : null,
                installing: registration.installing?.scriptURL ?? null,
                waiting: registration.waiting?.scriptURL ?? null,
                cacheStorageAvailable: typeof scope.caches !== "undefined",
                cacheNames: await scope.caches?.keys(),
                shell: cachedShell ? await cachedShell.text() : null,
              };
            });
          } catch (error) {
            return { scriptURL: worker.url(), error: String(error) };
          }
        }),
    );
    const fixture = (await (await request.get("/__namespace/state")).json()) as FixtureState;
    const diagnostics = JSON.stringify(
      { basePath, proxyMode: mount(info).proxyMode, cacheState, workers, fixture },
      null,
      2,
    );
    console.info(`Namespace cache-cleanup diagnostics:\n${diagnostics}`);
    await info.attach("namespace-cache-cleanup-diagnostics", {
      body: diagnostics,
      contentType: "application/json",
    });
  }
  expect(cacheState.present).toBe(false);
  await page.goto(`${basePath}voice/`);
  await expect(page.locator("#model")).toBeEnabled();
});

test("a fully cached legacy shell needs one-time exact-scope recovery before voice takeover", async ({
  page,
  request,
}, info) => {
  const { basePath } = mount(info);
  await request.post("/__namespace/deployment", { data: { enabled: false, legacyMode: "cached" } });
  await seedWorkers(page, basePath, true);
  await page.goto(`${basePath}project/session`);
  await expect(page.locator("#legacy-cached-shell")).toBeVisible();
  await request.post("/__namespace/deployment", { data: { enabled: true } });
  await page.reload();
  await expect(page.locator("#legacy-cached-shell")).toBeVisible();
  await expect(page.locator("#ocvd-server-script")).toHaveCount(0);
  // Model the documented user recovery with actual browser APIs. A cached page cannot run
  // a server-injected bootstrap that it never fetched. Do not disguise this with SW mocks.
  expect(
    await page.evaluate(async (base) => {
      const registration = await navigator.serviceWorker.getRegistration(base);
      if (registration?.scope !== new URL(base, location.origin).href) return false;
      return registration.unregister();
    }, basePath),
  ).toBe(true);
  await page.reload();
  await expect(page.locator("#network-shell")).toBeVisible();
  await expect(page.locator(".ocvd-btn")).toHaveCount(1);
  await expectVoiceControl(page, basePath);
  await expectUnrelatedUntouched(page, basePath);
  await page.goto(`${basePath}voice/`);
  await expect(page.locator("#model")).toBeEnabled();
});
