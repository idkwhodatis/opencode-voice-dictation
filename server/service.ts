import { timingSafeEqual } from "node:crypto";
import type { SettingsStore, VoiceSettings } from "./settings";
import type { ProviderStore } from "./provider";

import { createPaths, internalPath, normalizeProxyMode, type ProxyMode } from "./paths";

export const PREFIX = "/voice";
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg",
  "audio/mp4": "mp4", "video/mp4": "mp4", "audio/mpeg": "mp3",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface ServiceOptions {
  origin: string;
  basePath?: string;
  proxyMode?: ProxyMode;
  proxyToken: string;
  upstream: string;
  endpoint?: string;
  getApiKey?: () => Promise<string>;
  provider?: ProviderStore;
  settings: SettingsStore;
  assets: Map<string, { body: string | Blob; type: string }>;
  // Internal/test-only fixed overrides, useful for sub-MB and millisecond tests.
  // Production omits these so the current SQLite limits are used for every request.
  maxAudioBytes?: number;
  maxRecordingSeconds?: number;
  timeoutMs?: number;
  maxConcurrent?: number;
  requestsPerMinute?: number;
  // Injectable for tests; production always uses native fetch.
  fetcher?: typeof fetch;
}

function sameSecret(received: string | null, expected: string): boolean {
  const a = new TextEncoder().encode(received ?? "");
  const b = new TextEncoder().encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readLimitedBody(
  request: Request | Response,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const size = request.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || Number(size) > limit)) {
    throw new HttpError(413, "Request body is too large.");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new HttpError(408, "Request timed out or was cancelled."));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new HttpError(413, "Request body is too large.");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}

function cleanProxyHeaders(original: Headers): Headers {
  const headers = new Headers(original);
  const named = headers.get("connection")?.split(",").map((name) => name.trim()) ?? [];
  for (const name of [...named, "connection", "keep-alive", "proxy-authenticate",
    "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
    "host", "x-ocvd-proxy-token"]) {
    if (name) headers.delete(name);
  }
  return headers;
}

export function createService(options: ServiceOptions) {
  // A Caddy-injected credential is independent of browser-facing Basic/OIDC auth.
  if (options.proxyToken.length < 32) throw new Error("Proxy token must be at least 32 characters.");
  const paths = createPaths(options.basePath);
  const proxyMode = normalizeProxyMode(options.proxyMode);
  const script = `<script id="ocvd-server-script" data-base-path="${paths.basePath}" src="${paths.voice("voice.js")}"></script>`;
  const origin = new URL(options.origin).origin;
  if (options.origin !== origin) throw new Error("origin must contain only scheme and authority.");
  const upstream = new URL(options.upstream);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password ||
    upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("Invalid upstream origin.");
  const endpoint = new URL(options.endpoint ?? "https://api.groq.com/openai/v1/audio/transcriptions");
  const localEndpoint = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.username || endpoint.password || endpoint.hash ||
    (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && localEndpoint))) {
    throw new Error("STT endpoint must use HTTPS, or HTTP on loopback, without credentials/fragments.");
  }
  const fetcher = options.fetcher ?? fetch;
  let active = 0;
  let starts: number[] = [];

  function limits(settings: VoiceSettings) {
    return {
      maxAudioBytes: options.maxAudioBytes ?? settings.maxAudioMB * 1024 * 1024,
      maxRecordingSeconds: options.maxRecordingSeconds ?? settings.maxRecordingSeconds,
      timeoutMs: options.timeoutMs ?? settings.timeoutSeconds * 1000,
      maxConcurrent: options.maxConcurrent ?? settings.maxConcurrent,
      requestsPerMinute: options.requestsPerMinute ?? settings.requestsPerMinute,
    };
  }

  async function credentials(): Promise<{endpoint: string; apiKey: string}> {
    try {
      const selected = options.provider ? await options.provider.getCredentials() : { endpoint: endpoint.href, apiKey: await options.getApiKey?.() ?? "" };
      const value = selected.apiKey.trim();
      if (!value || value.length > 8192 || /[\r\n\0]/.test(value)) throw new Error();
      return { endpoint: selected.endpoint, apiKey: value };
    } catch { throw new HttpError(503, "Server API key is missing or unreadable. Check Voice settings and the server encryption key."); }
  }
  async function config(): Promise<Response> {
    let apiKeyConfigured = true;
    if (options.provider) apiKeyConfigured = (await options.provider.getStatus()).apiKeyConfigured;
    else try { await credentials(); } catch { apiKeyConfigured = false; }
    const settings = options.settings.get();
    const { maxAudioBytes, maxRecordingSeconds } = limits(settings);
    return json({ settings, apiKeyConfigured, maxAudioBytes, maxRecordingSeconds });
  }
  function mutationGuard(req: Request): void {
    if (req.headers.get("X-OCVD-Request") !== "1") throw new HttpError(403, "Missing same-origin request marker.");
  }
  async function transcribe(req: Request): Promise<Response> {
    mutationGuard(req);
    const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const extension = MIME_EXTENSIONS[mime];
    if (!extension) throw new HttpError(415, "Send an audio recording as the raw request body, with its audio Content-Type.");
    // Snapshot once, before credentials/body/provider awaits. Live changes only
    // affect new admissions and never alter or cancel an accepted recording.
    const settings = options.settings.get();
    const currentLimits = limits(settings);
    const now = Date.now();
    starts = starts.filter((time) => now - time < 60000);
    if (active >= currentLimits.maxConcurrent || starts.length >= currentLimits.requestsPerMinute) {
      return new Response(JSON.stringify({ error: "Voice service is busy or rate limited. Try again shortly." }), {
        status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60", "Cache-Control": "no-store" },
      });
    }
    active++;
    starts.push(now);
    try {
      const { endpoint: selectedEndpoint, apiKey } = await credentials();
      const uploadSignal = AbortSignal.any([req.signal, AbortSignal.timeout(30000)]);
      const audio = await readLimitedBody(req, currentLimits.maxAudioBytes, uploadSignal);
      if (!audio.length) throw new HttpError(400, "Recording is empty.");
      const form = new FormData();
      form.set("file", new Blob([audio.buffer as ArrayBuffer], { type: mime }), `recording.${extension}`);
      form.set("model", settings.model);
      form.set("temperature", String(settings.temperature));
      form.set("response_format", "json");
      if (settings.language) form.set("language", settings.language);
      if (settings.whisperPrompt) form.set("prompt", settings.whisperPrompt);
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(currentLimits.timeoutMs)]);
      let response: Response;
      let result: unknown;
      try {
        response = await fetcher(selectedEndpoint, {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}` },
          body: form, signal, redirect: "error",
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          const status = response.status === 429 ? 429 : 502;
          throw new HttpError(status, `Transcription provider returned HTTP ${response.status}. Check the server key, model, and provider quota.`);
        }
        const bytes = await readLimitedBody(response, 1024 * 1024, signal);
        result = JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        if (error instanceof HttpError && error.status !== 408 && error.status !== 413) throw error;
        if (signal.aborted) throw new HttpError(504, "Transcription timed out or was cancelled.");
        // Never relay provider errors/headers: they may echo credentials or recordings.
        throw new HttpError(502, "Transcription provider could not be reached or returned an invalid response.");
      }
      if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string") {
        throw new HttpError(502, "Transcription provider returned an invalid transcript.");
      }
      return json({ text: result.text.trim(), autoSubmit: settings.autoSubmit });
    } finally { active--; }
  }

  async function inject(req: Request, url: URL): Promise<Response> {
    if (!["GET", "HEAD"].includes(req.method) || req.headers.has("upgrade")) {
      throw new HttpError(405, "Only document GET/HEAD requests belong on the HTML injector.");
    }
    // Assign pathname rather than resolving an untrusted //host against the upstream.
    const target = new URL(upstream);
    target.pathname = url.pathname;
    target.search = url.search;
    const headers = cleanProxyHeaders(req.headers);
    headers.set("Accept-Encoding", "identity");
    headers.set("Host", new URL(origin).host);
    // Injection changes the entity: never reuse an unmodified cached 304/206 response.
    for (const name of ["if-none-match", "if-modified-since", "range", "if-range"]) headers.delete(name);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(30000)]);
    let response: Response;
    try { response = await fetcher(target, { method: req.method, headers, redirect: "manual", signal }); }
    catch { throw new HttpError(502, "OpenCode upstream is unavailable."); }
    const outHeaders = cleanProxyHeaders(response.headers);
    // Native fetch decodes compressed responses even if the upstream ignored identity.
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    const isHtml = response.status === 200 && /^text\/html\b/i.test(outHeaders.get("content-type") ?? "") &&
      !outHeaders.has("content-disposition");
    if (!isHtml || req.method === "HEAD") {
      return new Response(req.method === "HEAD" ? null : response.body, { status: response.status, headers: outHeaders });
    }
    const html = new TextDecoder().decode(await readLimitedBody(response, 4 * 1024 * 1024, signal));
    for (const name of ["etag", "last-modified", "content-md5", "digest", "content-digest", "accept-ranges"]) outHeaders.delete(name);
    outHeaders.set("Cache-Control", "no-store");
    // Preserve CSP and authentication headers. Do not disable CSP to force injection.
    if (html.includes('id="ocvd-server-script"')) return new Response(html, { headers: outHeaders });
    // A parser-blocking bootstrap must still obey upstream meta CSP. If a policy
    // appears after an app script, there is no safe point that both precedes app
    // registration and follows that policy; leave the shell unchanged instead.
    let sawScript = false;
    let latePolicy = false;
    await new HTMLRewriter()
        .on("script", { element() { sawScript = true; } })
        .on("meta", { element(element) {
          const directive = element.getAttribute("http-equiv")?.trim().toLowerCase();
          // Bun's rewriter exposes raw attribute entities rather than browser-decoded
          // values. Fail closed for encoded late directives instead of guessing.
          if (sawScript && (directive === "content-security-policy" || directive?.includes("&"))) latePolicy = true;
        } })
        .transform(new Response(html)).text();
    if (latePolicy) {
      outHeaders.set("X-OCVD-Injection", "skipped-late-meta-csp");
      return new Response(html, { headers: outHeaders });
    }
    let injected = false;
    return new HTMLRewriter()
      .on("head", { element(element) { element.onEndTag((end) => {
        if (!injected) { end.before(script, { html: true }); injected = true; }
      }); } })
      .on("script", { element(element) { if (!injected) { element.before(script, { html: true }); injected = true; } } })
      .onDocument({ end(end) { if (!injected) end.append(script, { html: true }); } })
      .transform(new Response(html, { headers: outHeaders }));
  }

  return async function handler(req: Request): Promise<Response> {
    try {
      if (!sameSecret(req.headers.get("X-OCVD-Proxy-Token"), options.proxyToken)) {
        throw new HttpError(401, "Unauthorized proxy request.");
      }
      const url = new URL(req.url);
      const path = internalPath(url.pathname, paths.basePath, proxyMode);
      if (path === null) throw new HttpError(404, "Request is outside the configured OpenCode mount.");
      const isApi = [`${PREFIX}/config`, `${PREFIX}/provider`, `${PREFIX}/transcribe`, `${PREFIX}/health`].includes(path);
      const requestOrigin = req.headers.get("origin");
      const site = req.headers.get("sec-fetch-site");
      if (isApi && ((requestOrigin !== null && requestOrigin !== origin) || site === "cross-site" || site === "same-site")) {
        throw new HttpError(403, "Cross-origin voice requests are not allowed.");
      }
      if (path === `${PREFIX}/provider`) {
        if (!options.provider) throw new HttpError(503, "Provider settings are unavailable.");
        if (req.method === "GET") return json(await options.provider.getStatus());
        if (req.method !== "PUT") throw new HttpError(405, "Use GET or PUT for provider settings.");
        mutationGuard(req);
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
          throw new HttpError(415, "Provider updates require application/json.");
        }
        const bytes = await readLimitedBody(req, 16384, AbortSignal.any([req.signal, AbortSignal.timeout(10000)]));
        let value: unknown;
        try { value = JSON.parse(new TextDecoder().decode(bytes)); }
        catch { throw new HttpError(400, "Invalid JSON."); }
        finally { bytes.fill(0); }
        try { options.provider.save(value); }
        catch { throw new HttpError(400, "Could not save provider settings. Check the endpoint, enter a key for a new target, and verify server key-file access."); }
        return json(await options.provider.getStatus());
      }
      if (path === `${PREFIX}/config`) {
        if (req.method === "GET") return await config();
        if (req.method === "PATCH") {
          mutationGuard(req);
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
            throw new HttpError(415, "Settings updates require application/json.");
          }
          const bytes = await readLimitedBody(req, 16384, AbortSignal.any([req.signal, AbortSignal.timeout(10000)]));
          let value: unknown;
          try { value = JSON.parse(new TextDecoder().decode(bytes)); }
          catch { throw new HttpError(400, "Invalid JSON."); }
          try { options.settings.patch(value); }
          catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid settings."); }
          return await config();
        }
        throw new HttpError(405, "Use GET or PATCH for settings.");
      }
      if (path === `${PREFIX}/transcribe`) {
        if (req.method !== "POST") throw new HttpError(405, "Use POST for transcription.");
        return await transcribe(req);
      }
      if (path === `${PREFIX}/health`) return req.method === "GET" ? json({ ok: true }) : json({ error: "Use GET." }, 405);
      if (path === PREFIX && ["GET", "HEAD"].includes(req.method)) return new Response(null, { status: 308, headers: { Location: paths.voiceBasePath } });
      const asset = options.assets.get(path);
      if (asset && ["GET", "HEAD"].includes(req.method)) {
        const response = new Response(req.method === "HEAD" ? null : asset.body, { headers: {
          "Content-Type": asset.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "same-origin",
          ...(path === `${PREFIX}/sw.js` ? { "Service-Worker-Allowed": paths.basePath } : {}),
          ...(asset.type.startsWith("text/html") ? { "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'" } : {}),
        } });
        if (!asset.type.startsWith("text/html") || req.method === "HEAD") return response;
        // Transform only plugin-owned markup; public URLs never inherit an internal proxy prefix.
        return new HTMLRewriter()
          .on('script[src="/voice/settings.js"]', { element(el) {
            el.setAttribute("src", paths.voice("settings.js"));
            el.setAttribute("data-base-path", paths.basePath);
          } })
          .on('link[href="/voice/settings.css"]', { element(el) { el.setAttribute("href", paths.voice("settings.css")); } })
          .on('a[href="/"]', { element(el) { el.setAttribute("href", paths.basePath); } })
          .transform(response);
      }
      if (path === PREFIX || path.startsWith(`${PREFIX}/`)) throw new HttpError(404, "Voice endpoint not found.");
      return await inject(req, url);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      return json({ error: "Internal voice service error." }, 500);
    }
  };
}
