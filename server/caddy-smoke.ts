// CI-only: stock Caddy + dummy credentials + loopback backend, never a real deployment.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = process.argv[2];
if (!executable) throw new Error("Pass the stock Caddy executable path.");
const dir = mkdtempSync(join(tmpdir(), "voice-caddy-test-"));
const token = "test-only-caddy-private-file-token-0123456789";
const tokenPath = join(dir, "proxy.token");
writeFileSync(tokenPath, token, { mode: 0o600 });
const backend = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  return new Response(req.headers.get("X-OCVD-Proxy-Token") === token ? "trusted" : "untrusted", {
    status: req.headers.get("X-OCVD-Proxy-Token") === token ? 200 : 401,
  });
} });
const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const origin = `http://127.0.0.1:${portProbe.port}`;
await portProbe.stop(true);
let caddy: ReturnType<typeof Bun.spawn> | undefined;
try {
  const hashResult = Bun.spawnSync([executable, "hash-password", "--plaintext", "test-only-password"]);
  if (hashResult.exitCode !== 0) throw new Error("Caddy dummy password hashing failed.");
  const hash = hashResult.stdout.toString().trim();
  const config = readFileSync(join(import.meta.dir, "Caddyfile"), "utf8")
    .replace("opencode.example.com", origin)
    .replace("REPLACE_WITH_BCRYPT_HASH", hash)
    .replaceAll("/path/to/opencode-voice/proxy.token", tokenPath)
    .replaceAll("127.0.0.1:4097", `127.0.0.1:${backend.port}`);
  const path = join(dir, "Caddyfile");
  writeFileSync(path, "{\n  admin off\n  persist_config off\n}\n" + config, { mode: 0o600 });
  const validation = Bun.spawnSync([executable, "adapt", "--config", path, "--adapter", "caddyfile", "--validate"]);
  if (validation.exitCode !== 0) throw new Error("Stock Caddy configuration validation failed.");
  caddy = Bun.spawn([executable, "run", "--config", path, "--adapter", "caddyfile"], { stdout: "ignore", stderr: "ignore" });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(`${origin}/voice/health`)).status === 401; } catch { /* Wait for startup. */ }
    if (ready) break;
    if (caddy.exitCode !== null) throw new Error("Caddy test process exited before readiness.");
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("Caddy authentication did not become ready.");
  for (const route of ["/voice/health", "/test-document"]) {
    const response = await fetch(`${origin}${route}`, { headers: {
      Authorization: `Basic ${btoa("opencode:test-only-password")}`,
      "X-OCVD-Proxy-Token": "forged-client-token",
      Accept: "text/html",
    } });
    if (response.status !== 200 || await response.text() !== "trusted") {
      throw new Error("Caddy did not overwrite the client token with its private-file value.");
    }
  }
  rmSync(tokenPath);
  const missing = await fetch(`${origin}/voice/health`, { headers: {
    Authorization: `Basic ${btoa("opencode:test-only-password")}`,
    "X-OCVD-Proxy-Token": token,
  } });
  if (missing.status === 200) throw new Error("Missing token file must not trust a client-supplied token.");
  console.info("Stock Caddy authentication and private token-file forwarding passed.");
} finally {
  if (caddy) { caddy.kill(); await caddy.exited; }
  await backend.stop(true);
  rmSync(dir, { recursive: true, force: true });
}
