import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./main";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function startTestServer(options: Parameters<typeof startServer>[0]) {
  const previousMask = process.umask();
  try { return await startServer(options); }
  finally { process.umask(previousMask); }
}
const TOKEN = "dummy-proxy-token-only-for-loopback-tests-0123456789";
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "voice-json-startup-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const path = join(dir, "config.json");
  writeFileSync(join(dir, "proxy.token"), TOKEN, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ publicOrigin: origin, port, proxyTokenFile: "proxy.token",
    databasePath: "settings.sqlite", encryptionKeyFile: "keys/master.key" }), { mode: 0o600 });
  const launch = () => startTestServer({ args: ["--config", path], env: {}, home: dir, cwd: "/" });
  const request = (route: string, init: RequestInit = {}) => fetch(`${origin}${route}`, {
    ...init, headers: { "X-OCVD-Proxy-Token": TOKEN, "X-OCVD-Request": "1",
      "Content-Type": "application/json", Origin: origin, ...init.headers },
  });
  return { dir, path, launch, request, origin, port };
}

test("JSON-only startup, live preferences and encrypted provider state survive restart without environment variables", async () => {
  const f = await fixture();
  let app = await f.launch();
  let stopped = false;
  cleanups.push(async () => { if (!stopped) await app.stop(); });
  expect((await f.request("/voice/health")).status).toBe(200);
  expect((await fetch(`${f.origin}/voice/health`)).status).toBe(401);
  const initial = await (await f.request("/voice/config")).json();
  expect(initial.settings.maxConcurrent).toBe(2);
  expect(initial.apiKeyConfigured).toBe(false);
  expect((await f.request("/voice/config", { method: "PATCH", body: JSON.stringify({
    maxAudioMB: 7, maxConcurrent: 4, timeoutSeconds: 90, model: "local-whisper",
  }) })).status).toBe(200);
  const key = "dummy-provider-secret-only-never-sent";
  expect((await f.request("/voice/provider", { method: "PUT", body: JSON.stringify({ provider: "groq", apiKey: key }) })).status).toBe(200);
  await app.stop(); stopped = true;
  expect(readFileSync(join(f.dir, "settings.sqlite")).includes(Buffer.from(key))).toBe(false);
  expect(readFileSync(join(f.dir, "keys/master.key")).length).toBe(32);
  app = await f.launch(); stopped = false;
  const persisted = await (await f.request("/voice/config")).json();
  expect(persisted.settings.model).toBe("local-whisper");
  expect(persisted.settings.maxConcurrent).toBe(4);
  expect(persisted.settings.timeoutSeconds).toBe(90);
  expect(persisted.maxAudioBytes).toBe(7 * 1024 * 1024);
  expect(persisted.apiKeyConfigured).toBe(true);
  expect(JSON.stringify(persisted)).not.toContain(TOKEN);
  expect(JSON.stringify(persisted)).not.toContain(key);
  expect(JSON.stringify(persisted)).not.toContain(f.dir);
});

test("mixed startup sources fail before changing an existing database or encryption key", async () => {
  const f = await fixture();
  const app = await f.launch();
  await app.stop();
  const before = readFileSync(join(f.dir, "settings.sqlite"));
  await expect(startTestServer({ args: ["--config", f.path], env: { VOICE_PORT: String(f.port) }, home: f.dir }))
    .rejects.toThrow("cannot be combined");
  expect(readFileSync(join(f.dir, "settings.sqlite"))).toEqual(before);
});
