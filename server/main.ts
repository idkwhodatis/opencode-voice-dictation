import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { openProviderStore, GROQ_ENDPOINT, type ProviderStore } from "./provider";
import { openSettings } from "./settings";
import { createService } from "./service";

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = Bun.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export async function buildBrowser(): Promise<Blob> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "browser.ts")],
    target: "browser", format: "iife", minify: true,
  });
  if (!result.success || !result.outputs[0]) {
    throw new Error(`Browser build failed: ${result.logs.map(String).join("\n")}`);
  }
  return result.outputs[0];
}

export async function startServer() {
  process.umask(0o077);
  const origin = Bun.env.VOICE_PUBLIC_ORIGIN;
  if (!origin) throw new Error("Set VOICE_PUBLIC_ORIGIN to your external HTTPS origin (no trailing slash).");
  const publicURL = new URL(origin);
  if (publicURL.protocol !== "https:" && !(publicURL.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(publicURL.hostname))) {
    throw new Error("Use HTTPS for the public origin. HTTP is only allowed on loopback for development.");
  }
  const keyPath = Bun.env.GROQ_API_KEY_FILE;
  const absoluteKeyPath = keyPath ? resolve(keyPath) : undefined;
  const tokenFile = Bun.env.VOICE_PROXY_TOKEN_FILE;
  const proxyToken = (tokenFile ? await Bun.file(tokenFile).text() : Bun.env.VOICE_PROXY_TOKEN ?? "").trim();
  if (proxyToken.length < 32 || proxyToken.startsWith("REPLACE_")) throw new Error("Set VOICE_PROXY_TOKEN or VOICE_PROXY_TOKEN_FILE (at least 32 characters).");
  const statePath = resolve(Bun.env.VOICE_DB_PATH ?? join(homedir(), ".local/state/opencode-voice/settings.sqlite"));
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const port = integer("VOICE_PORT", 4097, 1, 65535);
  // VOICE_HOST allows listening beyond loopback, e.g. when the reverse proxy
  // runs in a container and reaches the host through a LAN address.
  const hostname = Bun.env.VOICE_HOST?.trim() || "127.0.0.1";
  const maxAudioBytes = integer("VOICE_MAX_AUDIO_MB", 20, 1, 100) * 1024 * 1024;
  const assets = new Map([
    ["/voice/voice.js", { body: await buildBrowser(), type: "text/javascript; charset=utf-8" }],
    ["/voice/", { body: Bun.file(join(import.meta.dir, "settings.html")), type: "text/html; charset=utf-8" }],
    ["/voice/settings.js", { body: Bun.file(join(import.meta.dir, "settings.js")), type: "text/javascript; charset=utf-8" }],
    ["/voice/settings.css", { body: Bun.file(join(import.meta.dir, "settings.css")), type: "text/css; charset=utf-8" }],
  ]);
  const settings = openSettings(statePath);
  chmodSync(statePath, 0o600);
  const encryptionKeyPath = resolve(Bun.env.VOICE_ENCRYPTION_KEY_FILE ?? join(homedir(), ".config/opencode-voice/encryption.key"));
  let provider: ProviderStore | undefined;
  try {
    provider = openProviderStore(statePath, encryptionKeyPath, absoluteKeyPath ? {
      endpoint: Bun.env.VOICE_STT_ENDPOINT ?? GROQ_ENDPOINT,
      getApiKey: () => Bun.file(absoluteKeyPath).text(),
    } : undefined);
    const handler = createService({
      origin, proxyToken, settings, assets, provider,
      upstream: Bun.env.OPENCODE_UPSTREAM ?? "http://127.0.0.1:4096",
      maxAudioBytes,
      maxRecordingSeconds: integer("VOICE_MAX_RECORDING_SECONDS", 300, 1, 3600),
      timeoutMs: integer("VOICE_TIMEOUT_SECONDS", 60, 1, 300) * 1000,
      maxConcurrent: integer("VOICE_MAX_CONCURRENT", 2, 1, 16),
      requestsPerMinute: integer("VOICE_REQUESTS_PER_MINUTE", 10, 1, 1000),
    });
    const server = Bun.serve({
      hostname, port,
      maxRequestBodySize: maxAudioBytes,
      idleTimeout: 0, // Individual uploads/provider calls have explicit deadlines.
      fetch: handler,
      error: () => Response.json({ error: "Voice service request failed." }, { status: 500 }),
    });
    console.info(`OpenCode voice listening on http://${hostname}:${server.port}`);
    return { server, async stop() { await server.stop(); provider?.close(); settings.close(); } };
  } catch (error) { provider?.close(); settings.close(); throw error; }
}

if (import.meta.main) {
  try {
    const app = await startServer();
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void app.stop().then(() => process.exit(0));
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  } catch (error) {
    // Startup errors include configuration names, never the contents of secret files.
    console.error(error instanceof Error ? error.message : "Voice service startup failed.");
    process.exitCode = 1;
  }
}
