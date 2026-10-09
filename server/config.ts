import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeBasePath, normalizeProxyMode, type ProxyMode } from "./paths";
import { GROQ_ENDPOINT } from "./provider";
import { DEFAULT_RUNTIME_LIMITS, type RuntimeLimits } from "./settings";

export interface StartupConfiguration {
  publicOrigin: string;
  basePath: string;
  proxyMode: ProxyMode;
  host: string;
  port: number;
  upstream: string;
  databasePath: string;
  encryptionKeyFile: string;
  proxyTokenFile?: string;
  // Resolved from a separate file (or the legacy environment), never JSON.
  proxyToken: string;
  legacyProvider?: { apiKeyFile: string; endpoint: string };
}

export interface LoadedConfiguration {
  config: StartupConfiguration;
  mode: "json" | "legacy-env";
  warnings: string[];
  configPath?: string;
  initialRuntimeLimits?: RuntimeLimits;
}

export interface ConfigurationOptions {
  env?: Record<string, string | undefined>;
  args?: string[];
  home?: string;
  cwd?: string;
  readFile?: (path: string) => string | Promise<string>;
}

const LEGACY_VARIABLES = [
  "VOICE_PUBLIC_ORIGIN",
  "VOICE_HOST",
  "VOICE_PORT",
  "OPENCODE_UPSTREAM",
  "VOICE_DB_PATH",
  "VOICE_ENCRYPTION_KEY_FILE",
  "VOICE_PROXY_TOKEN",
  "VOICE_PROXY_TOKEN_FILE",
  "GROQ_API_KEY_FILE",
  "VOICE_STT_ENDPOINT",
  "VOICE_MAX_AUDIO_MB",
  "VOICE_MAX_RECORDING_SECONDS",
  "VOICE_TIMEOUT_SECONDS",
  "VOICE_MAX_CONCURRENT",
  "VOICE_REQUESTS_PER_MINUTE",
] as const;
const STARTUP_FIELDS = [
  "publicOrigin",
  "basePath",
  "proxyMode",
  "host",
  "port",
  "upstream",
  "databasePath",
  "encryptionKeyFile",
  "proxyTokenFile",
  "legacyProvider",
];
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Voice configuration must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function string(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    throw new Error(
      `${name} must be a nonempty string without surrounding whitespace or control characters.`,
    );
  }
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function origin(value: unknown, name: "publicOrigin" | "upstream"): string {
  const input = string(value, name);
  try {
    if (input.length > 2048 || /[\s\\]/.test(input) || !/^https?:\/\/[^/?#]+\/?$/.test(input))
      throw new Error();
    const url = new URL(input);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      input.slice(input.indexOf("://") + 3).includes("@")
    )
      throw new Error();
    if (
      name === "publicOrigin" &&
      (input !== url.origin || (url.protocol !== "https:" && !LOOPBACK.includes(url.hostname)))
    )
      throw new Error();
    // Reject even empty query/fragment suffixes; URL.search/hash discard them.
    if (input.includes("?") || input.includes("#")) throw new Error();
    return input;
  } catch {
    throw new Error(
      name === "publicOrigin"
        ? "publicOrigin must be an HTTPS origin without a trailing slash, path, credentials, query or fragment; HTTP is allowed only on loopback."
        : "upstream must be an HTTP or HTTPS origin without a path, credentials, query or fragment.",
    );
  }
}

function hostname(value: unknown): string {
  const input = string(value, "host");
  const domain =
    /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.?$/;
  if (!isIP(input) && !domain.test(input)) {
    throw new Error("host must be an IP address or hostname without a scheme, port or path.");
  }
  return input;
}

function filePath(value: unknown, name: string, base: string, home: string): string {
  const input = string(value, name);
  if (input === "~") return resolve(home);
  if (input.startsWith("~/")) return resolve(home, input.slice(2));
  if (input.startsWith("~"))
    throw new Error(`${name} supports only the current user's ~/ home expansion.`);
  return resolve(base, input);
}

function endpoint(value: unknown): string {
  const input = string(value, "legacyProvider.endpoint");
  try {
    if (input.length > 2048 || /[\s\\?#]/.test(input) || !/^https?:\/\//i.test(input))
      throw new Error();
    const url = new URL(input);
    const authority = input.slice(input.indexOf("://") + 3).split("/")[0];
    const path = input.slice(input.indexOf("://") + 3).replace(/^[^/]*/, "");
    const decoded = decodeURIComponent(path);
    const [a, b] = url.hostname.split(".").map(Number);
    const privateIPv4 =
      isIP(url.hostname) === 4 &&
      (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
    if (
      authority.includes("@") ||
      url.username ||
      url.password ||
      !url.hostname ||
      !path.startsWith("/") ||
      path === "/" ||
      decoded.includes("//") ||
      hasControlCharacters(decoded) ||
      /[\\ ]/.test(decoded) ||
      /%2f|%5c/i.test(path) ||
      decoded.split("/").some((part) => part === "." || part === "..") ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          (privateIPv4 || url.hostname === "[::1]" || url.hostname === "localhost")
        ))
    )
      throw new Error();
    if (url.protocol === "http:" && privateIPv4 && authority.replace(/:\d+$/, "") !== url.hostname)
      throw new Error();
    return url.href;
  } catch {
    throw new Error(
      "Invalid legacyProvider.endpoint. Use an HTTPS transcription endpoint, or HTTP on loopback/private IP addresses, without credentials, query or fragment.",
    );
  }
}

function configArgument(args: string[]): string | undefined {
  let path: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let next: string;
    if (arg === "--config") {
      next = args[++index];
      if (!next || next.startsWith("--")) throw new Error("--config requires a file path.");
    } else if (arg.startsWith("--config=")) {
      next = arg.slice("--config=".length);
      if (!next) throw new Error("--config requires a file path.");
    } else {
      throw new Error(
        "Unknown startup argument. Use --config <path> to select a configuration file.",
      );
    }
    if (path !== undefined) throw new Error("Specify --config only once.");
    path = next;
  }
  return path;
}

async function proxyToken(
  path: string | undefined,
  raw: string | undefined,
  read: (path: string) => string | Promise<string>,
): Promise<string> {
  let token: string;
  try {
    token = (path ? await read(path) : (raw ?? "")).trim();
  } catch {
    throw new Error(
      "Proxy token file is missing or unreadable. Check proxyTokenFile or VOICE_PROXY_TOKEN_FILE.",
    );
  }
  if (!/^[\x21-\x7e]{32,8192}$/.test(token) || token.startsWith("REPLACE_")) {
    throw new Error(
      "Proxy token must contain 32–8192 printable non-space ASCII characters and must not be a placeholder.",
    );
  }
  return token;
}

export async function loadConfiguration(
  options: ConfigurationOptions = {},
): Promise<LoadedConfiguration> {
  const env = options.env ?? process.env;
  const home = resolve(options.home ?? homedir());
  const cwd = options.cwd ?? process.cwd();
  const read = options.readFile ?? ((path: string) => readFile(path, "utf8"));
  const selected = configArgument(options.args ?? process.argv.slice(2));
  const configPath =
    selected === undefined
      ? join(home, ".config/opencode-voice/config.json")
      : filePath(selected, "--config", cwd, home);
  const defaults = {
    host: "127.0.0.1",
    port: 4097,
    upstream: "http://127.0.0.1:4096",
    databasePath: join(home, ".local/state/opencode-voice/settings.sqlite"),
    encryptionKeyFile: join(home, ".config/opencode-voice/encryption.key"),
    proxyTokenFile: join(home, ".config/opencode-voice/proxy.token"),
  };
  let contents: string | undefined;
  try {
    contents = await read(configPath);
  } catch (error) {
    if (!missing(error)) throw new Error("Voice configuration file is unreadable.");
    if (selected !== undefined)
      throw new Error("The explicitly selected voice configuration file does not exist.");
  }
  if (contents !== undefined) {
    const mixed = LEGACY_VARIABLES.filter((name) => env[name] !== undefined);
    if (mixed.length) {
      throw new Error(
        `JSON configuration cannot be combined with legacy environment variables. Unset: ${mixed.join(", ")}.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error("Voice configuration file must contain valid JSON.");
    }
    const input = object(parsed);
    if (Object.keys(input).some((name) => !STARTUP_FIELDS.includes(name))) {
      throw new Error(
        "Unknown voice configuration field. Only startup fields are accepted; secrets belong in separate files and runtime limits belong in Settings.",
      );
    }
    const base = dirname(configPath);
    const config: StartupConfiguration = {
      publicOrigin: origin(input.publicOrigin, "publicOrigin"),
      basePath: normalizeBasePath(input.basePath),
      proxyMode: normalizeProxyMode(input.proxyMode),
      host: hostname(input.host === undefined ? defaults.host : input.host),
      port: integer(input.port === undefined ? defaults.port : input.port, "port", 1, 65535),
      upstream: origin(
        input.upstream === undefined ? defaults.upstream : input.upstream,
        "upstream",
      ),
      databasePath: filePath(
        input.databasePath === undefined ? defaults.databasePath : input.databasePath,
        "databasePath",
        base,
        home,
      ),
      encryptionKeyFile: filePath(
        input.encryptionKeyFile === undefined
          ? defaults.encryptionKeyFile
          : input.encryptionKeyFile,
        "encryptionKeyFile",
        base,
        home,
      ),
      proxyTokenFile: filePath(
        input.proxyTokenFile === undefined ? defaults.proxyTokenFile : input.proxyTokenFile,
        "proxyTokenFile",
        base,
        home,
      ),
      proxyToken: "",
    };
    if (input.legacyProvider !== undefined) {
      const provider = object(input.legacyProvider);
      if (Object.keys(provider).some((name) => name !== "apiKeyFile" && name !== "endpoint")) {
        throw new Error("Unknown legacyProvider field. Only apiKeyFile and endpoint are accepted.");
      }
      config.legacyProvider = {
        apiKeyFile: filePath(provider.apiKeyFile, "legacyProvider.apiKeyFile", base, home),
        endpoint: endpoint(provider.endpoint === undefined ? GROQ_ENDPOINT : provider.endpoint),
      };
    }
    config.proxyToken = await proxyToken(config.proxyTokenFile, undefined, read);
    return { config, configPath, mode: "json", warnings: [] };
  }
  if (
    !["VOICE_PUBLIC_ORIGIN", "VOICE_PROXY_TOKEN", "VOICE_PROXY_TOKEN_FILE"].some(
      (name) => env[name] !== undefined,
    )
  ) {
    throw new Error(
      "No voice configuration found. Create ~/.config/opencode-voice/config.json from config.example.json, or select a file with --config <path>.",
    );
  }
  const warnings = [
    "Legacy environment configuration is deprecated. Migrate to ~/.config/opencode-voice/config.json or --config, and remove all supported legacy environment variables. Legacy limit variables seed only missing database fields; saved Settings values take precedence afterward.",
  ];
  const tokenFile = env.VOICE_PROXY_TOKEN_FILE
    ? resolve(cwd, env.VOICE_PROXY_TOKEN_FILE)
    : undefined;
  if (tokenFile && env.VOICE_PROXY_TOKEN !== undefined) {
    warnings.push(
      "Both VOICE_PROXY_TOKEN_FILE and VOICE_PROXY_TOKEN are set; VOICE_PROXY_TOKEN_FILE takes precedence.",
    );
  }
  const legacyInteger = (name: string, fallback: number, min: number, max: number): number =>
    integer(env[name] === undefined ? fallback : Number(env[name]), name, min, max);
  const config: StartupConfiguration = {
    publicOrigin: origin(env.VOICE_PUBLIC_ORIGIN, "publicOrigin"),
    basePath: "/",
    proxyMode: "preserve",
    host: hostname(env.VOICE_HOST?.trim() || defaults.host),
    port: legacyInteger("VOICE_PORT", defaults.port, 1, 65535),
    upstream: origin(env.OPENCODE_UPSTREAM ?? defaults.upstream, "upstream"),
    databasePath: resolve(cwd, env.VOICE_DB_PATH ?? defaults.databasePath),
    encryptionKeyFile: resolve(cwd, env.VOICE_ENCRYPTION_KEY_FILE ?? defaults.encryptionKeyFile),
    proxyTokenFile: tokenFile,
    proxyToken: "",
  };
  if (env.GROQ_API_KEY_FILE) {
    const legacyEndpoint = env.VOICE_STT_ENDPOINT ?? GROQ_ENDPOINT;
    // Preserve startup and UI recovery for old installs: the provider store validates this
    // only when legacy credentials are needed, and saved encrypted credentials win.
    try {
      endpoint(legacyEndpoint);
    } catch {
      warnings.push(
        "VOICE_STT_ENDPOINT is invalid. Legacy provider credentials will be unavailable; saved provider settings take precedence and can be changed in Settings.",
      );
    }
    config.legacyProvider = {
      apiKeyFile: resolve(cwd, env.GROQ_API_KEY_FILE),
      endpoint: legacyEndpoint,
    };
  }
  const initialRuntimeLimits: RuntimeLimits = {
    maxAudioMB: legacyInteger("VOICE_MAX_AUDIO_MB", DEFAULT_RUNTIME_LIMITS.maxAudioMB, 1, 100),
    maxRecordingSeconds: legacyInteger(
      "VOICE_MAX_RECORDING_SECONDS",
      DEFAULT_RUNTIME_LIMITS.maxRecordingSeconds,
      1,
      3600,
    ),
    timeoutSeconds: legacyInteger(
      "VOICE_TIMEOUT_SECONDS",
      DEFAULT_RUNTIME_LIMITS.timeoutSeconds,
      1,
      300,
    ),
    maxConcurrent: legacyInteger(
      "VOICE_MAX_CONCURRENT",
      DEFAULT_RUNTIME_LIMITS.maxConcurrent,
      1,
      16,
    ),
    requestsPerMinute: legacyInteger(
      "VOICE_REQUESTS_PER_MINUTE",
      DEFAULT_RUNTIME_LIMITS.requestsPerMinute,
      1,
      1000,
    ),
  };
  config.proxyToken = await proxyToken(tokenFile, env.VOICE_PROXY_TOKEN, read);
  return { config, mode: "legacy-env", warnings, initialRuntimeLimits };
}
