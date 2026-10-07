import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ConfigurationOptions, loadConfiguration } from "./config";
import { GROQ_ENDPOINT } from "./provider";

const TOKEN = "dummy-proxy-token-for-configuration-tests-only";
const SECRET = "DO_NOT_EXPOSE_THIS_DUMMY_SECRET";
const DEFAULT_LIMITS = {
  maxAudioMB: 20,
  maxRecordingSeconds: 300,
  timeoutSeconds: 60,
  maxConcurrent: 2,
  requestsPerMinute: 10,
};
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "ocvd-config-"));
  directories.push(directory);
  const home = join(directory, "home");
  const cwd = join(directory, "work");
  const configPath = join(home, ".config/opencode-voice/config.json");
  const tokenPath = join(home, ".config/opencode-voice/proxy.token");
  mkdirSync(cwd, { recursive: true });
  const options: ConfigurationOptions = { home, cwd, args: [], env: {} };
  const write = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  write(tokenPath, `${TOKEN}\n`);
  return {
    directory,
    home,
    cwd,
    configPath,
    tokenPath,
    options,
    write,
    json(value: unknown, path = configPath) {
      write(path, JSON.stringify(value));
    },
    load(overrides: ConfigurationOptions = {}) {
      return loadConfiguration({ ...options, ...overrides });
    },
  };
}

async function failure(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(SECRET);
    return message;
  }
  throw new Error("Expected configuration loading to fail.");
}

describe("JSON startup configuration", () => {
  test("loads the default file with secure external origin and absolute default paths", async () => {
    const f = fixture();
    f.json({ publicOrigin: "https://voice.example.test" });
    expect(await f.load()).toEqual({
      mode: "json",
      warnings: [],
      configPath: f.configPath,
      config: {
        publicOrigin: "https://voice.example.test",
        host: "127.0.0.1",
        port: 4097,
        upstream: "http://127.0.0.1:4096",
        databasePath: join(f.home, ".local/state/opencode-voice/settings.sqlite"),
        encryptionKeyFile: join(f.home, ".config/opencode-voice/encryption.key"),
        proxyTokenFile: f.tokenPath,
        proxyToken: TOKEN,
      },
    });
    expect(existsSync(join(f.home, ".local/state/opencode-voice/settings.sqlite"))).toBe(false);
    expect(existsSync(join(f.home, ".config/opencode-voice/encryption.key"))).toBe(false);
  });

  for (const flag of ["separate", "equals"] as const) {
    test(`resolves ${flag} --config and relative file paths against the config directory`, async () => {
      const f = fixture();
      const path = join(f.cwd, "deployment", "voice.json");
      f.json(
        {
          publicOrigin: "https://voice.example.test",
          host: "0.0.0.0",
          port: 8087,
          upstream: "https://upstream.example.test/",
          databasePath: "state/settings.sqlite",
          encryptionKeyFile: "keys/encryption.key",
          proxyTokenFile: "secrets/proxy.token",
          legacyProvider: { apiKeyFile: "secrets/provider.key" },
        },
        path,
      );
      f.write(join(dirname(path), "secrets/proxy.token"), TOKEN);
      const args =
        flag === "separate"
          ? ["--config", "deployment/voice.json"]
          : ["--config=deployment/voice.json"];
      const loaded = await f.load({ args });
      expect(loaded.configPath).toBe(path);
      expect(loaded.initialRuntimeLimits).toBeUndefined();
      expect(loaded.config).toEqual({
        publicOrigin: "https://voice.example.test",
        host: "0.0.0.0",
        port: 8087,
        upstream: "https://upstream.example.test/",
        databasePath: join(dirname(path), "state/settings.sqlite"),
        encryptionKeyFile: join(dirname(path), "keys/encryption.key"),
        proxyTokenFile: join(dirname(path), "secrets/proxy.token"),
        proxyToken: TOKEN,
        legacyProvider: {
          apiKeyFile: join(dirname(path), "secrets/provider.key"),
          endpoint: GROQ_ENDPOINT,
        },
      });
      // The fallback provider key is optional until a request needs credentials.
      expect(existsSync(loaded.config.legacyProvider?.apiKeyFile ?? "")).toBe(false);
    });
  }

  test("expands current-user home paths even when the config lives elsewhere", async () => {
    const f = fixture();
    const path = join(f.home, "deployment/config.json");
    f.json(
      {
        publicOrigin: "http://localhost:4097",
        databasePath: "~/state/voice.sqlite",
        encryptionKeyFile: "~/keys/encryption.key",
        proxyTokenFile: "~/.config/opencode-voice/proxy.token",
        legacyProvider: {
          apiKeyFile: "~/keys/provider.key",
          endpoint: "https://stt.example.test/transcribe",
        },
      },
      path,
    );
    const loaded = await f.load({ args: ["--config", "~/deployment/config.json"] });
    expect(loaded.configPath).toBe(path);
    expect(loaded.config.databasePath).toBe(join(f.home, "state/voice.sqlite"));
    expect(loaded.config.encryptionKeyFile).toBe(join(f.home, "keys/encryption.key"));
    expect(loaded.config.legacyProvider?.apiKeyFile).toBe(join(f.home, "keys/provider.key"));
  });

  test("uses the injectable reader for config and token files only", async () => {
    const f = fixture();
    const paths: string[] = [];
    const loaded = await f.load({
      readFile: async (path) => {
        paths.push(path);
        if (path === f.configPath)
          return JSON.stringify({ publicOrigin: "https://voice.example.test" });
        if (path === f.tokenPath) return TOKEN;
        throw new Error(SECRET);
      },
    });
    expect(paths).toEqual([f.configPath, f.tokenPath]);
    expect(loaded.config.proxyToken).toBe(TOKEN);
  });

  for (const publicOrigin of [
    "https://voice.example.test",
    "http://localhost:4097",
    "http://127.0.0.1:4097",
    "http://[::1]:4097",
  ]) {
    test(`accepts public origin ${publicOrigin}`, async () => {
      const f = fixture();
      f.json({ publicOrigin });
      expect((await f.load()).config.publicOrigin).toBe(publicOrigin);
    });
  }
  for (const publicOrigin of [
    "http://voice.example.test",
    "https://voice.example.test/",
    "https://voice.example.test/path",
    "https://user:password@voice.example.test",
    "https://voice.example.test?",
    "https://voice.example.test#",
    "https://voice.example.test/?secret=hidden",
    "https://voice.example.test/#fragment",
    "https://voice.example.test/a/..",
    "https:///voice.example.test",
    "https://voice.example.test\\path",
    " https://voice.example.test",
    "https://voice.example.test\n",
    "https://VOICE.example.test",
    "http://2130706433",
    "file:///tmp/voice",
    "javascript:alert(1)",
    SECRET,
    "",
  ]) {
    test(`rejects invalid public origin ${JSON.stringify(publicOrigin)}`, async () => {
      const f = fixture();
      f.json({ publicOrigin });
      expect(await failure(f.load())).toContain("publicOrigin");
    });
  }
  for (const upstream of [
    "http://127.0.0.1:4096",
    "http://upstream.internal",
    "https://upstream.example.test/",
  ]) {
    test(`accepts upstream origin ${upstream}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test", upstream });
      expect((await f.load()).config.upstream).toBe(upstream);
    });
  }
  for (const upstream of [
    "http://user:password@localhost:4096",
    "http://localhost:4096/path",
    "http://localhost:4096/a/..",
    "http://localhost:4096?",
    "http://localhost:4096#",
    "file:///tmp/upstream",
    "http:///localhost",
    "http://localhost\\path",
    "http://localhost:4096/\n",
    SECRET,
  ]) {
    test(`rejects invalid upstream ${JSON.stringify(upstream)}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test", upstream });
      expect(await failure(f.load())).toContain("upstream");
    });
  }
  for (const host of ["127.0.0.1", "0.0.0.0", "::1", "::", "localhost", "voice.internal"]) {
    test(`accepts bind hostname ${host}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test", host });
      expect((await f.load()).config.host).toBe(host);
    });
  }
  for (const host of [
    "",
    " localhost",
    "http://localhost",
    "localhost:4097",
    "[::1]",
    "a/b",
    "a..b",
    "-bad",
    "bad-",
    "a\n",
  ]) {
    test(`rejects invalid bind hostname ${JSON.stringify(host)}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test", host });
      expect(await failure(f.load())).toContain("host");
    });
  }

  for (const port of [1, 65535]) {
    test(`accepts port boundary ${port}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test", port });
      expect((await f.load()).config.port).toBe(port);
    });
  }
  for (const port of [0, 65536, -1, 1.5, "4097", null, false]) {
    test(`rejects invalid port ${JSON.stringify(port)}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test", port });
      expect(await failure(f.load())).toContain("port");
    });
  }
  for (const field of [
    "publicOrigin",
    "host",
    "upstream",
    "databasePath",
    "encryptionKeyFile",
    "proxyTokenFile",
  ]) {
    for (const value of [null, false, 123, [], {}]) {
      test(`rejects non-string ${field} ${JSON.stringify(value)}`, async () => {
        const f = fixture();
        f.json({ publicOrigin: "https://voice.example.test", [field]: value });
        expect(await failure(f.load())).toContain(field);
      });
    }
  }
  for (const field of ["databasePath", "encryptionKeyFile", "proxyTokenFile"]) {
    for (const value of ["", "~other/config", "foo\0bar", " leading", "trailing "]) {
      test(`rejects invalid path in ${field} ${JSON.stringify(value)}`, async () => {
        const f = fixture();
        f.json({ publicOrigin: "https://voice.example.test", [field]: value });
        expect(await failure(f.load())).toContain(field);
      });
    }
  }

  for (const field of [
    "proxyToken",
    "apiKey",
    "maxAudioMB",
    "maxRecordingSeconds",
    "timeoutSeconds",
    "maxConcurrent",
    "requestsPerMinute",
    SECRET,
  ]) {
    test(`rejects unknown or non-startup field ${field} without echoing it`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test", [field]: SECRET });
      expect(await failure(f.load())).toContain("Unknown voice configuration field");
    });
  }
  for (const value of [null, [], true, 42, "configuration"]) {
    test(`rejects a non-object JSON root ${JSON.stringify(value)}`, async () => {
      const f = fixture();
      f.json(value);
      expect(await failure(f.load())).toContain("JSON object");
    });
  }
  test("rejects a missing public origin", async () => {
    const f = fixture();
    f.json({});
    expect(await failure(f.load())).toContain("publicOrigin");
  });
  test("redacts invalid JSON parser errors and does not fall back to legacy", async () => {
    const f = fixture();
    f.write(f.configPath, `{"${SECRET}":`);
    expect(await failure(f.load())).toBe("Voice configuration file must contain valid JSON.");
    expect(
      await failure(
        f.load({
          env: { VOICE_PUBLIC_ORIGIN: "https://voice.example.test", VOICE_PROXY_TOKEN: TOKEN },
        }),
      ),
    ).toContain("cannot be combined");
  });
  test("never falls back when the default file exists but is unreadable", async () => {
    const f = fixture();
    const readFile = async () => {
      throw Object.assign(new Error(SECRET), { code: "EACCES" });
    };
    expect(
      await failure(
        f.load({
          env: { VOICE_PUBLIC_ORIGIN: "https://voice.example.test", VOICE_PROXY_TOKEN: TOKEN },
          readFile,
        }),
      ),
    ).toBe("Voice configuration file is unreadable.");
  });
  test("reports missing config with setup instructions and never creates one", async () => {
    const f = fixture();
    expect(await failure(f.load())).toContain("Create ~/.config/opencode-voice/config.json");
    expect(existsSync(f.configPath)).toBe(false);
  });
  test("unrelated or partial non-origin/token legacy variables do not enable legacy mode", async () => {
    const f = fixture();
    expect(
      await failure(
        f.load({ env: { PATH: "/bin", VOICE_MAX_AUDIO_MB: "30", GROQ_API_KEY_FILE: "key" } }),
      ),
    ).toContain("No voice configuration found");
  });
  test("an explicitly missing config never falls back to valid legacy environment", async () => {
    const f = fixture();
    expect(
      await failure(
        f.load({
          args: ["--config", "missing.json"],
          env: { VOICE_PUBLIC_ORIGIN: "https://voice.example.test", VOICE_PROXY_TOKEN: TOKEN },
        }),
      ),
    ).toContain("explicitly selected");
  });

  const legacyNames = [
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
  ];
  for (const name of legacyNames) {
    test(`rejects mixed JSON plus ${name}, including empty values`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test" });
      expect(await failure(f.load({ env: { [name]: SECRET } }))).toContain(name);
      expect(await failure(f.load({ env: { [name]: "" } }))).toContain(name);
    });
  }
  test("rejects matching legacy values rather than silently merging them", async () => {
    const f = fixture();
    f.json({ publicOrigin: "https://voice.example.test" });
    expect(
      await failure(
        f.load({
          env: {
            VOICE_PUBLIC_ORIGIN: "https://voice.example.test",
            VOICE_PROXY_TOKEN_FILE: f.tokenPath,
          },
        }),
      ),
    ).toContain("VOICE_PUBLIC_ORIGIN, VOICE_PROXY_TOKEN_FILE");
  });
  test("ignores unrelated environment variables in JSON mode", async () => {
    const f = fixture();
    f.json({ publicOrigin: "https://voice.example.test" });
    expect(
      (await f.load({ env: { PATH: "/bin", HOME: f.home, UNRELATED_SECRET: SECRET } })).mode,
    ).toBe("json");
  });

  for (const args of [
    ["--config"],
    ["--config="],
    ["--config", "--unknown"],
    ["--other", SECRET],
    [SECRET],
    ["--config=a", "--config=b"],
    ["--config", "a", "--config=b"],
  ]) {
    test(`rejects invalid command-line arguments ${JSON.stringify(args)}`, async () => {
      const f = fixture();
      expect(await failure(f.load({ args }))).toMatch(/--config|startup argument/);
    });
  }
});

describe("legacy provider file configuration", () => {
  for (const legacyProvider of [
    null,
    [],
    true,
    SECRET,
    {},
    { endpoint: GROQ_ENDPOINT },
    { apiKeyFile: false },
    { apiKeyFile: "key", apiKey: SECRET },
    { apiKeyFile: "key", [SECRET]: true },
  ]) {
    test(`rejects malformed provider ${JSON.stringify(legacyProvider)}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test", legacyProvider });
      await failure(f.load());
    });
  }
  for (const endpoint of [
    GROQ_ENDPOINT,
    "http://127.0.0.1:3000/transcribe",
    "http://localhost:3000/transcribe",
    "http://[::1]:3000/transcribe",
    "http://192.168.1.8/transcribe",
    "http://10.0.0.2/transcribe",
    "http://172.16.1.8/transcribe",
  ]) {
    test(`accepts legacy provider endpoint ${endpoint}`, async () => {
      const f = fixture();
      f.json({
        publicOrigin: "https://voice.example.test",
        legacyProvider: { apiKeyFile: "key", endpoint },
      });
      expect((await f.load()).config.legacyProvider?.endpoint).toBe(endpoint);
    });
  }
  for (const endpoint of [
    "http://stt.example.test/transcribe",
    "https://stt.example.test/",
    "https://user:password@stt.example.test/transcribe",
    "https://stt.example.test/transcribe?",
    "https://stt.example.test/transcribe#",
    "https://stt.example.test/a/../transcribe",
    "https://stt.example.test/a%2fb",
    "https://stt.example.test/a//b",
    "http://2130706433/transcribe",
    "https://stt.example.test/%00",
    SECRET,
    false,
    null,
  ]) {
    test(`rejects invalid provider endpoint ${JSON.stringify(endpoint)}`, async () => {
      const f = fixture();
      f.json({
        publicOrigin: "https://voice.example.test",
        legacyProvider: { apiKeyFile: "key", endpoint },
      });
      expect(await failure(f.load())).toContain("legacyProvider.endpoint");
    });
  }
});

describe("proxy token secret files", () => {
  test("redacts missing and unreadable token errors, including injected reader details", async () => {
    const f = fixture();
    f.json({ publicOrigin: "https://voice.example.test", proxyTokenFile: SECRET });
    expect(await failure(f.load())).toContain("Proxy token file is missing or unreadable");
    expect(
      await failure(
        f.load({
          readFile: async (path) => {
            if (path === f.configPath) return readFileSync(path, "utf8");
            throw new Error(`${SECRET} ${TOKEN}`);
          },
        }),
      ),
    ).toContain("Proxy token file is missing or unreadable");
  });
  for (const token of [
    "",
    "short",
    "REPLACE_WITH_A_REAL_TOKEN_BEFORE_RUNNING",
    "a".repeat(31),
    "a".repeat(8193),
    `${TOKEN}\n${TOKEN}`,
    `${TOKEN}\0`,
    `${TOKEN} with spaces`,
  ]) {
    test(`rejects unsafe token case ${JSON.stringify(token.slice(0, 45))}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test" });
      f.write(f.tokenPath, token);
      expect(await failure(f.load())).toContain("Proxy token must contain");
    });
  }
  for (const size of [32, 8192]) {
    test(`accepts token length boundary ${size}`, async () => {
      const f = fixture();
      f.json({ publicOrigin: "https://voice.example.test" });
      f.write(f.tokenPath, "a".repeat(size));
      expect((await f.load()).config.proxyToken).toHaveLength(size);
    });
  }
});

describe("legacy environment migration", () => {
  const required = { VOICE_PUBLIC_ORIGIN: "https://voice.example.test", VOICE_PROXY_TOKEN: TOKEN };
  test("preserves old defaults and warns that saved settings take precedence over one-time seeds", async () => {
    const f = fixture();
    const loaded = await f.load({ env: required });
    expect(loaded.mode).toBe("legacy-env");
    expect(loaded.configPath).toBeUndefined();
    expect(loaded.initialRuntimeLimits).toEqual(DEFAULT_LIMITS);
    expect(loaded.config).toEqual({
      publicOrigin: required.VOICE_PUBLIC_ORIGIN,
      proxyToken: TOKEN,
      proxyTokenFile: undefined,
      host: "127.0.0.1",
      port: 4097,
      upstream: "http://127.0.0.1:4096",
      databasePath: join(f.home, ".local/state/opencode-voice/settings.sqlite"),
      encryptionKeyFile: join(f.home, ".config/opencode-voice/encryption.key"),
    });
    expect(loaded.warnings.join(" ")).toContain("deprecated");
    expect(loaded.warnings.join(" ")).toContain("seed only missing database fields");
    expect(loaded.warnings.join(" ")).toContain("saved Settings values take precedence");
    expect(existsSync(f.configPath)).toBe(false);
  });
  test("resolves all explicit legacy paths against CWD, keeping literal tilde behavior", async () => {
    const f = fixture();
    f.write(join(f.cwd, "proxy.token"), TOKEN);
    const loaded = await f.load({
      env: {
        ...required,
        VOICE_PROXY_TOKEN_FILE: "proxy.token",
        VOICE_DB_PATH: "db/settings.sqlite",
        VOICE_ENCRYPTION_KEY_FILE: "~/keys/encryption.key",
        GROQ_API_KEY_FILE: "provider.key",
        VOICE_STT_ENDPOINT: "https://stt.example.test/transcribe",
        VOICE_HOST: " 0.0.0.0 ",
        VOICE_PORT: "8089",
        OPENCODE_UPSTREAM: "http://upstream.internal:4096",
        VOICE_MAX_AUDIO_MB: "40",
        VOICE_MAX_RECORDING_SECONDS: "600",
        VOICE_TIMEOUT_SECONDS: "90",
        VOICE_MAX_CONCURRENT: "4",
        VOICE_REQUESTS_PER_MINUTE: "20",
      },
    });
    expect(loaded.config.proxyTokenFile).toBe(join(f.cwd, "proxy.token"));
    expect(loaded.config.databasePath).toBe(join(f.cwd, "db/settings.sqlite"));
    expect(loaded.config.encryptionKeyFile).toBe(join(f.cwd, "~/keys/encryption.key"));
    expect(loaded.config.legacyProvider).toEqual({
      apiKeyFile: join(f.cwd, "provider.key"),
      endpoint: "https://stt.example.test/transcribe",
    });
    expect(loaded.config.host).toBe("0.0.0.0");
    expect(loaded.config.port).toBe(8089);
    expect(loaded.config.upstream).toBe("http://upstream.internal:4096");
    expect(loaded.initialRuntimeLimits).toEqual({
      maxAudioMB: 40,
      maxRecordingSeconds: 600,
      timeoutSeconds: 90,
      maxConcurrent: 4,
      requestsPerMinute: 20,
    });
  });
  test("keeps token-file precedence, warns about both sources and does not echo either token", async () => {
    const f = fixture();
    const loaded = await f.load({
      env: { ...required, VOICE_PROXY_TOKEN: SECRET, VOICE_PROXY_TOKEN_FILE: f.tokenPath },
    });
    expect(loaded.config.proxyToken).toBe(TOKEN);
    expect(loaded.warnings).toHaveLength(2);
    expect(loaded.warnings[1]).toContain("VOICE_PROXY_TOKEN_FILE takes precedence");
    expect(loaded.warnings.join(" ")).not.toContain(SECRET);
    expect(loaded.warnings.join(" ")).not.toContain(TOKEN);
  });
  test("an unreadable token file fails instead of falling back to the direct token", async () => {
    const f = fixture();
    expect(
      await failure(f.load({ env: { ...required, VOICE_PROXY_TOKEN_FILE: SECRET } })),
    ).toContain("Proxy token file");
  });
  test("empty legacy host and token-file values preserve old default/fallback behavior", async () => {
    const f = fixture();
    const loaded = await f.load({
      env: { ...required, VOICE_HOST: "  ", VOICE_PROXY_TOKEN_FILE: "", GROQ_API_KEY_FILE: "" },
    });
    expect(loaded.config.host).toBe("127.0.0.1");
    expect(loaded.config.proxyToken).toBe(TOKEN);
    expect(loaded.config.proxyTokenFile).toBeUndefined();
    expect(loaded.config.legacyProvider).toBeUndefined();
  });
  test("supports a provider key file with the old Groq default without reading it", async () => {
    const f = fixture();
    const loaded = await f.load({
      env: { ...required, GROQ_API_KEY_FILE: "missing-provider.key" },
    });
    expect(loaded.config.legacyProvider).toEqual({
      apiKeyFile: join(f.cwd, "missing-provider.key"),
      endpoint: GROQ_ENDPOINT,
    });
  });
  test("invalid old provider endpoints warn without blocking encrypted-provider startup or UI recovery", async () => {
    const f = fixture();
    const loaded = await f.load({
      env: { ...required, GROQ_API_KEY_FILE: "provider.key", VOICE_STT_ENDPOINT: SECRET },
    });
    expect(loaded.config.legacyProvider?.endpoint).toBe(SECRET);
    expect(loaded.warnings.join(" ")).toContain("VOICE_STT_ENDPOINT is invalid");
    expect(loaded.warnings.join(" ")).not.toContain(SECRET);
    const unused = await f.load({ env: { ...required, VOICE_STT_ENDPOINT: SECRET } });
    expect(unused.config.legacyProvider).toBeUndefined();
  });
  test("still ignores unknown legacy variables for compatibility", async () => {
    const f = fixture();
    expect((await f.load({ env: { ...required, VOICE_UNKNOWN: SECRET } })).mode).toBe("legacy-env");
  });
  for (const [name, min, max] of [
    ["VOICE_PORT", 1, 65535],
    ["VOICE_MAX_AUDIO_MB", 1, 100],
    ["VOICE_MAX_RECORDING_SECONDS", 1, 3600],
    ["VOICE_TIMEOUT_SECONDS", 1, 300],
    ["VOICE_MAX_CONCURRENT", 1, 16],
    ["VOICE_REQUESTS_PER_MINUTE", 1, 1000],
  ] as const) {
    test(`validates legacy numeric boundaries for ${name}`, async () => {
      const f = fixture();
      for (const value of [String(min), String(max)]) {
        expect((await f.load({ env: { ...required, [name]: value } })).mode).toBe("legacy-env");
      }
      for (const value of [
        String(min - 1),
        String(max + 1),
        "1.5",
        "NaN",
        "Infinity",
        "",
        SECRET,
      ]) {
        expect(await failure(f.load({ env: { ...required, [name]: value } }))).toContain(name);
      }
    });
  }
  test("requires origin and a valid proxy token even in incomplete legacy mode", async () => {
    const f = fixture();
    expect(await failure(f.load({ env: { VOICE_PROXY_TOKEN: TOKEN } }))).toContain("publicOrigin");
    expect(
      await failure(f.load({ env: { VOICE_PUBLIC_ORIGIN: required.VOICE_PUBLIC_ORIGIN } })),
    ).toContain("Proxy token");
  });
});
