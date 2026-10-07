import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openProviderStore, type ProviderStore } from "./provider";
import { loadConfiguration, type ConfigurationOptions } from "./config";
import { openSettings, type SettingsStore } from "./settings";
import { createService } from "./service";

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

export async function startServer(options: ConfigurationOptions = {}) {
  process.umask(0o077);
  const loaded = await loadConfiguration(options);
  const config = loaded.config;
  for (const warning of loaded.warnings) console.warn(warning);
  const assets = new Map([
    ["/voice/voice.js", { body: await buildBrowser(), type: "text/javascript; charset=utf-8" }],
    ["/voice/", { body: Bun.file(join(import.meta.dir, "settings.html")), type: "text/html; charset=utf-8" }],
    ["/voice/settings.js", { body: Bun.file(join(import.meta.dir, "settings.js")), type: "text/javascript; charset=utf-8" }],
    ["/voice/settings.css", { body: Bun.file(join(import.meta.dir, "settings.css")), type: "text/css; charset=utf-8" }],
  ]);
  let settings: SettingsStore;
  try {
    mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
    settings = openSettings(config.databasePath, loaded.initialRuntimeLimits);
  } catch { throw new Error("Could not open the settings database. Check databasePath, directory access, and database integrity."); }
  let provider: ProviderStore | undefined;
  try {
    chmodSync(config.databasePath, 0o600);
    provider = openProviderStore(config.databasePath, config.encryptionKeyFile, config.legacyProvider ? {
      endpoint: config.legacyProvider.endpoint,
      getApiKey: () => Bun.file(config.legacyProvider!.apiKeyFile).text(),
    } : undefined);
    const handler = createService({
      origin: config.publicOrigin, proxyToken: config.proxyToken, settings, assets, provider,
      upstream: config.upstream,
    });
    const server = Bun.serve({
      hostname: config.host, port: config.port,
      // Fixed transport ceiling; the lower live limit is snapshotted and enforced by the handler.
      maxRequestBodySize: 100 * 1024 * 1024,
      idleTimeout: 0, // Individual uploads/provider calls have explicit deadlines.
      fetch: handler,
      error: () => Response.json({ error: "Voice service request failed." }, { status: 500 }),
    });
    console.info(`OpenCode voice listening on http://${config.host}:${server.port}`);
    return { server, async stop() { await server.stop(); provider?.close(); settings.close(); } };
  } catch {
    provider?.close(); settings.close();
    throw new Error("Voice service startup failed. Check the listen address/port, database access, and encryption-key configuration.");
  }
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
