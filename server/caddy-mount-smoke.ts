import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const executable = process.argv[2];
if (!executable) throw new Error("Pass the stock Caddy executable path.");
const dir = mkdtempSync(join(tmpdir(), "voice-caddy-docs-"));
const token = "test-only-docs-private-file-token-0123456789";
const tokenPath = join(dir, "proxy.token");
writeFileSync(tokenPath, token, { mode: 0o600 });
const voice = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  return Response.json({ path: new URL(req.url).pathname, trusted: req.headers.get("X-OCVD-Proxy-Token") === token });
}});
const app = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  return Response.json({ app: true, path: new URL(req.url).pathname });
}});
const hash = Bun.spawnSync([executable, "hash-password", "--plaintext", "test-only-password"]).stdout.toString().trim();
const examples = [...readFileSync(join(import.meta.dir, "README.md"), "utf8").matchAll(/```caddyfile\n([\s\S]*?)\n```/g)].map(match => match[1]);
if (examples.length !== 2) throw new Error(`Expected two nested examples; found ${examples.length}`);
const auth = { Authorization: `Basic ${btoa("opencode:test-only-password")}`, "X-OCVD-Proxy-Token": "forged-client-token" };
try {
  for (const [index, raw] of examples.entries()) {
    const mode = index === 0 ? "preserve" : "strip";
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const origin = `http://127.0.0.1:${probe.port}`;
    await probe.stop(true);
    const path = join(dir, `Caddyfile-${mode}`);
    writeFileSync(path, "{\n admin off\n persist_config off\n}\n" + raw
      .replace("opencode.example.com", origin)
      .replace("REPLACE_WITH_BCRYPT_HASH", hash)
      .replaceAll("/path/to/opencode-voice/proxy.token", tokenPath)
      .replaceAll("127.0.0.1:4097", `127.0.0.1:${voice.port}`)
      .replaceAll("127.0.0.1:4096", `127.0.0.1:${app.port}`));
    const check = Bun.spawnSync([executable, "adapt", "--config", path, "--adapter", "caddyfile", "--validate"]);
    if (check.exitCode !== 0) throw new Error(`${mode}: ${check.stderr.toString()}`);
    const caddy = Bun.spawn([executable, "run", "--config", path, "--adapter", "caddyfile"], { stdout: "ignore", stderr: "ignore" });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { ready = (await fetch(origin + "/tools/opencode/voice/sw.js")).status === 401; } catch {}
        if (ready) break;
        if (caddy.exitCode !== null) throw new Error(`${mode}: Caddy exited before readiness`);
        await Bun.sleep(50);
      }
      if (!ready) throw new Error(`${mode}: authentication did not become ready`);
      for (const suffix of ["voice/", "voice/sw.js", "voice/settings.css", "voice/config", "voice/provider", "voice/transcribe"]) {
        const route = `/tools/opencode/${suffix}`;
        if ((await fetch(origin + route)).status !== 401) throw new Error(`${mode}: anonymous ${route}`);
        const response = await fetch(origin + route, { headers: auth });
        const result = await response.json();
        const expected = mode === "preserve" ? route : `/${suffix}`;
        if (!result.trusted || result.path !== expected) throw new Error(`${mode}: voice ${route}: ${JSON.stringify(result)}`);
      }
      const html = await (await fetch(origin + "/tools/opencode/project/session/123", { headers: { ...auth, Accept: "text/html" } })).json();
      if (!html.trusted || html.path !== (mode === "preserve" ? "/tools/opencode/project/session/123" : "/project/session/123")) throw new Error(`${mode}: HTML path mismatch`);
      for (const suffix of ["api/test", "event", "global/event", "assets/app.js"]) {
        const result = await (await fetch(origin + `/tools/opencode/${suffix}`, { headers: auth })).json();
        if (!result.app || result.path !== (mode === "preserve" ? `/tools/opencode/${suffix}` : `/${suffix}`)) throw new Error(`${mode}: app path mismatch`);
      }
      for (const suffix of ["", "/voice"]) {
        const response = await fetch(origin + `/tools/opencode${suffix}`, { headers: auth, redirect: "manual" });
        if (response.status !== 308 || response.headers.get("location") !== `/tools/opencode${suffix}/`) throw new Error(`${mode}: redirect mismatch`);
      }
      for (const outside of ["/voice/config", "/voice/sw.js", "/tools/opencode-other/voice/config", "/sibling/voice/config"]) {
        if ((await fetch(origin + outside, { headers: auth })).status !== 404) throw new Error(`${mode}: outside mount ${outside}`);
      }
      console.info(`${mode}: nested README Caddy example validates; auth, overwritten token, routing, redirects, and namespace isolation passed.`);
    } finally { caddy.kill(); await caddy.exited; }
  }
} finally { await voice.stop(true); await app.stop(true); rmSync(dir, { recursive: true, force: true }); }
