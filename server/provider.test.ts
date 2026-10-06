import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GROQ_ENDPOINT, openProviderStore, type ProviderStore } from "./provider";
import { DEFAULT_SETTINGS, openSettings } from "./settings";

const KEY = "dummy-provider-secret-for-encryption-tests";
const NEXT_KEY = "dummy-replacement-provider-secret";
const CUSTOM = "https://stt.example.test/v1/audio/transcriptions";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture(legacy?: Parameters<typeof openProviderStore>[2]) {
  const directory = mkdtempSync(join(tmpdir(), "ocvd-provider-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, "settings.sqlite");
  const keyPath = join(directory, "credentials", "master.key");
  let store = openProviderStore(dbPath, keyPath, legacy);
  cleanup.push(() => store.close());
  return {
    dbPath,
    keyPath,
    directory,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = openProviderStore(dbPath, keyPath, legacy);
      return store;
    },
  };
}
function envelope(dbPath: string) {
  const db = new Database(dbPath);
  try {
    return db
      .query<{ ciphertext: Uint8Array | null; iv: Uint8Array | null; tag: Uint8Array | null }, []>(
        "SELECT ciphertext, iv, tag FROM provider_credentials WHERE id = 1",
      )
      .get();
  } finally {
    db.close();
  }
}
function edit(dbPath: string, sql: string, ...values: (string | Uint8Array)[]) {
  const db = new Database(dbPath);
  try {
    db.query(sql).run(...values);
  } finally {
    db.close();
  }
}
async function unavailable(store: ProviderStore) {
  const status = await store.getStatus();
  expect(status.apiKeyConfigured).toBe(false);
  expect(status.error).toBe(
    "Provider credentials are unavailable. Check the server credential store.",
  );
  expect(JSON.stringify(status)).not.toContain(KEY);
  await expect(store.getCredentials()).rejects.toThrow("Provider credentials are unavailable.");
}

describe("encrypted provider persistence", () => {
  test("starts empty without creating a master key", async () => {
    const f = fixture();
    expect(await f.store.getStatus()).toEqual({
      provider: "groq",
      endpoint: GROQ_ENDPOINT,
      apiKeyConfigured: false,
      source: "none",
    });
    expect(existsSync(f.keyPath)).toBe(false);
    await expect(f.store.getCredentials()).rejects.toThrow("No provider API key");
  });
  test("encrypts, survives restart and shares settings database without changing its schema version", async () => {
    const f = fixture();
    const settings = openSettings(f.dbPath);
    try {
      settings.patch({ model: "whisper-large-v3", temperature: 0.4 });
      f.store.save({ provider: "groq", apiKey: KEY });
      const credentials = await f.reopen().getCredentials();
      expect(credentials).toEqual({ endpoint: GROQ_ENDPOINT, apiKey: KEY });
      expect(await f.store.getStatus()).toEqual({
        provider: "groq",
        endpoint: GROQ_ENDPOINT,
        apiKeyConfigured: true,
        source: "encrypted",
      });
      expect(settings.get()).toEqual({
        ...DEFAULT_SETTINGS,
        model: "whisper-large-v3",
        temperature: 0.4,
      });
      const db = new Database(f.dbPath);
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      expect(readFileSync(f.dbPath).includes(Buffer.from(KEY))).toBe(false);
      expect(readFileSync(f.keyPath)).toHaveLength(32);
      expect(readFileSync(f.keyPath).includes(Buffer.from(KEY))).toBe(false);
      expect(lstatSync(f.keyPath).mode & 0o777).toBe(0o600);
      expect(lstatSync(dirname(f.keyPath)).mode & 0o777).toBe(0o700);
    } finally {
      settings.close();
    }
  });
  test("key updates and same-target omitted key both use fresh random nonces", async () => {
    const f = fixture();
    f.store.save({ provider: "groq", apiKey: KEY });
    const first = envelope(f.dbPath);
    f.store.save({ provider: "groq" });
    const second = envelope(f.dbPath);
    expect(first?.iv).not.toEqual(second?.iv);
    expect(first?.ciphertext).not.toEqual(second?.ciphertext);
    expect((await f.store.getCredentials()).apiKey).toBe(KEY);
    f.store.save({ provider: "groq", apiKey: NEXT_KEY });
    expect(envelope(f.dbPath)?.iv).not.toEqual(second?.iv);
    expect((await f.reopen().getCredentials()).apiKey).toBe(NEXT_KEY);
  });
  test("changing provider or endpoint requires an explicit new key", async () => {
    const f = fixture();
    f.store.save({ provider: "groq", apiKey: KEY });
    expect(() => f.store.save({ provider: "custom", endpoint: CUSTOM })).toThrow(
      "Enter an API key",
    );
    expect(() => f.store.save({ provider: "custom", endpoint: GROQ_ENDPOINT })).toThrow(
      "Enter an API key",
    );
    expect((await f.store.getCredentials()).endpoint).toBe(GROQ_ENDPOINT);
    f.store.save({ provider: "custom", endpoint: CUSTOM, apiKey: NEXT_KEY });
    expect(await f.store.getCredentials()).toEqual({ endpoint: CUSTOM, apiKey: NEXT_KEY });
    expect(() =>
      f.store.save({ provider: "custom", endpoint: "https://other.example.test/transcribe" }),
    ).toThrow();
  });
  test("normalizes the endpoint and retains the key only for that exact canonical target", async () => {
    const f = fixture();
    f.store.save({
      provider: "custom",
      endpoint: "HTTPS://STT.EXAMPLE.TEST:443/transcribe",
      apiKey: KEY,
    });
    f.store.save({ provider: "custom", endpoint: "https://stt.example.test/transcribe" });
    expect((await f.store.getCredentials()).endpoint).toBe("https://stt.example.test/transcribe");
    expect(() =>
      f.store.save({ provider: "custom", endpoint: "https://stt.example.test/transcribe/" }),
    ).toThrow();
  });
  test("explicit removal survives restart and permanently disables legacy fallback", async () => {
    let reads = 0;
    const f = fixture({
      endpoint: GROQ_ENDPOINT,
      getApiKey: async () => {
        reads++;
        return KEY;
      },
    });
    expect((await f.store.getStatus()).source).toBe("legacy");
    f.store.save({ provider: "groq", apiKey: NEXT_KEY });
    f.store.save({ provider: "groq", apiKey: null });
    const before = reads;
    expect(await f.reopen().getStatus()).toEqual({
      provider: "groq",
      endpoint: GROQ_ENDPOINT,
      apiKeyConfigured: false,
      source: "none",
    });
    await expect(f.store.getCredentials()).rejects.toThrow("No provider API key");
    expect(reads).toBe(before);
    expect(envelope(f.dbPath)).toEqual({ ciphertext: null, iv: null, tag: null });
    f.store.save({ provider: "groq", apiKey: NEXT_KEY });
    expect((await f.store.getCredentials()).apiKey).toBe(NEXT_KEY);
  });
  test("removal before first encrypted save disables legacy without generating a key", async () => {
    const f = fixture({ endpoint: GROQ_ENDPOINT, getApiKey: async () => KEY });
    f.store.save({ provider: "groq", apiKey: null });
    expect((await f.reopen().getStatus()).source).toBe("none");
    expect(existsSync(f.keyPath)).toBe(false);
  });
});

describe("legacy compatibility", () => {
  test.each(["https://legacy.example.test/", "https://legacy.example.test/transcribe?key=old"])(
    "invalid legacy endpoint does not block explicit replacement or removal: %s",
    async (endpoint) => {
      for (const provider of ["groq", "custom"] as const) {
        let reads = 0;
        const f = fixture({
          endpoint,
          getApiKey: async () => {
            reads++;
            return KEY;
          },
        });
        await unavailable(f.store);
        f.store.save({
          provider,
          ...(provider === "custom" ? { endpoint: CUSTOM } : {}),
          apiKey: NEXT_KEY,
        });
        expect((await f.store.getCredentials()).apiKey).toBe(NEXT_KEY);
        expect(reads).toBe(0);
      }
      const f = fixture({ endpoint, getApiKey: async () => KEY });
      f.store.save({ provider: "groq", apiKey: null });
      expect((await f.reopen().getStatus()).source).toBe("none");
      expect(existsSync(f.keyPath)).toBe(false);
    },
  );
  test("reads the legacy callback anew and never stores its plaintext", async () => {
    let key = KEY;
    const f = fixture({ endpoint: "http://localhost:9000/transcribe", getApiKey: async () => key });
    expect(await f.store.getStatus()).toEqual({
      provider: "custom",
      endpoint: "http://localhost:9000/transcribe",
      apiKeyConfigured: true,
      source: "legacy",
    });
    key = NEXT_KEY;
    expect((await f.store.getCredentials()).apiKey).toBe(NEXT_KEY);
    expect(envelope(f.dbPath)).toBeNull();
    expect(existsSync(f.keyPath)).toBe(false);
  });
  test.each(["", " \n ", "bad\nkey"])(
    "does not report an invalid legacy key as configured: %j",
    async (key) => {
      const f = fixture({ endpoint: GROQ_ENDPOINT, getApiKey: async () => key });
      await unavailable(f.store);
      expect((await f.store.getStatus()).source).toBe("legacy");
    },
  );
  test("redacts legacy filesystem errors", async () => {
    const f = fixture({
      endpoint: GROQ_ENDPOINT,
      getApiKey: async () => {
        throw new Error(`/private/${KEY}`);
      },
    });
    await unavailable(f.store);
  });
  test("status settles to the tombstone when removal races a legacy read", async () => {
    let finish: (value: string) => void = () => {};
    const f = fixture({
      endpoint: GROQ_ENDPOINT,
      getApiKey: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = f.store.getStatus();
    f.store.save({ provider: "groq", apiKey: null });
    finish(KEY);
    expect(await pending).toEqual({
      provider: "groq",
      endpoint: GROQ_ENDPOINT,
      apiKeyConfigured: false,
      source: "none",
    });
  });
  test("pending legacy reads cannot re-enable a removed credential", async () => {
    let finish: (value: string) => void = () => {};
    const f = fixture({
      endpoint: GROQ_ENDPOINT,
      getApiKey: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = f.store.getCredentials();
    f.store.save({ provider: "groq", apiKey: null });
    finish(KEY);
    await expect(pending).rejects.toThrow("No provider API key");
  });
});

describe("validation and endpoint boundaries", () => {
  test.each(
    [
      null,
      [],
      "secret",
      {},
      { provider: "other", apiKey: KEY },
      { provider: "groq", apiKey: "" },
      { provider: "groq", apiKey: "a\r\nb" },
      { provider: "groq", apiKey: 123 },
      { provider: "groq", apiKey: "a".repeat(4097) },
      { provider: "groq", endpoint: CUSTOM, apiKey: KEY },
      { provider: "groq", keyFile: "/tmp/ignored", apiKey: KEY },
      { provider: "groq", apiKey: KEY, other: true },
      JSON.parse('{"provider":"groq","__proto__":{"polluted":true}}'),
    ].map((value) => [value]),
  )("rejects invalid payloads without exposing them", async (value) => {
    const f = fixture();
    expect(() => f.store.save(value)).toThrow("Invalid provider configuration.");
    expect((await f.store.getStatus()).apiKeyConfigured).toBe(false);
    expect(existsSync(f.keyPath)).toBe(false);
  });
  test.each([
    "https://stt.example.test",
    "https://stt.example.test/",
    "/v1/transcribe",
    "ftp://stt.example.test/transcribe",
    "https://@stt.example.test/transcribe",
    "https://name:password@stt.example.test/transcribe",
    "https://stt.example.test/transcribe?key=secret",
    "https://stt.example.test/transcribe?",
    "https://stt.example.test/transcribe#",
    " https://stt.example.test/transcribe",
    "https://stt.example.test/a/../transcribe",
    "https://stt.example.test/%2e%2e/transcribe",
    "https://stt.example.test/a%2ftranscribe",
    "https://stt.example.test/%00transcribe",
    "https://stt.example.test/%zz",
    "https://stt.example.test//transcribe",
    "https://stt.example.test/a\\transcribe",
    "http://public.example.test/transcribe",
    "http://localhost/transcribe",
    "http://localhost.example.test/transcribe",
    "http://8.8.8.8/transcribe",
    "http://169.254.169.254/transcribe",
    "http://172.15.0.1/transcribe",
    "http://172.32.0.1/transcribe",
    "http://192.169.0.1/transcribe",
    "http://[::]/transcribe",
    "http://[::ffff:127.0.0.1]/transcribe",
    "http://2130706433/transcribe",
    "http://0x7f000001/transcribe",
    "http://127.1/transcribe",
    "http://0177.0.0.1/transcribe",
  ])("rejects unsafe or malformed custom endpoint %s", (endpoint) => {
    const f = fixture();
    expect(() => f.store.save({ provider: "custom", endpoint, apiKey: KEY })).toThrow(
      "Invalid provider configuration.",
    );
    expect(existsSync(f.keyPath)).toBe(false);
  });
  test.each([
    "https://stt.example.test/transcribe",
    "https://stt.example.test/api/v1/audio/transcriptions",
    "http://127.0.0.1:8000/transcribe",
    "http://127.20.0.1/transcribe",
    "http://[::1]:8000/transcribe",
    "http://10.0.0.2:8000/v1/audio/transcriptions",
    "http://172.16.0.2/transcribe",
    "http://172.31.255.255/transcribe",
    "http://192.168.0.1/transcribe",
  ])("supports explicit compatible endpoint %s", async (endpoint) => {
    const f = fixture();
    f.store.save({ provider: "custom", endpoint, apiKey: KEY });
    expect(await f.store.getCredentials()).toEqual({ endpoint, apiKey: KEY });
  });
});

describe("fail-closed integrity and master key security", () => {
  test.each([
    "UPDATE provider_credentials SET tag = NULL",
    "UPDATE provider_credentials SET provider = 'corrupt'",
    "UPDATE provider_credentials SET endpoint = 'invalid'",
    "UPDATE provider_credentials SET version = 99",
  ])("explicit removal can recover structurally corrupt persisted metadata", async (sql) => {
    let reads = 0;
    const f = fixture({
      endpoint: GROQ_ENDPOINT,
      getApiKey: async () => {
        reads++;
        return KEY;
      },
    });
    f.store.save({ provider: "groq", apiKey: KEY });
    edit(f.dbPath, sql);
    await unavailable(f.store);
    f.store.save({ provider: "groq", apiKey: null });
    expect((await f.reopen().getStatus()).source).toBe("none");
    expect(reads).toBe(0);
    f.store.save({ provider: "groq", apiKey: NEXT_KEY });
    expect((await f.store.getCredentials()).apiKey).toBe(NEXT_KEY);
  });
  test.each(["ciphertext", "iv", "tag"])(
    "detects modified %s and never falls back",
    async (field) => {
      let legacyReads = 0;
      const f = fixture({
        endpoint: GROQ_ENDPOINT,
        getApiKey: async () => {
          legacyReads++;
          return NEXT_KEY;
        },
      });
      f.store.save({ provider: "groq", apiKey: KEY });
      const row = envelope(f.dbPath);
      const bytes = Buffer.from(row?.[field as "ciphertext" | "iv" | "tag"] ?? []);
      bytes[0] ^= 1;
      edit(f.dbPath, `UPDATE provider_credentials SET ${field} = ?`, bytes);
      await unavailable(f.reopen());
      expect(legacyReads).toBe(0);
      expect((await f.store.getStatus()).source).toBe("encrypted");
    },
  );
  test.each([
    ["provider", "custom"],
    ["endpoint", CUSTOM],
    ["version", "2"],
    ["provider", "unsupported"],
  ])("authenticates or rejects altered metadata %s", async (field, value) => {
    const f = fixture();
    f.store.save({ provider: "groq", apiKey: KEY });
    edit(f.dbPath, `UPDATE provider_credentials SET ${field} = ?`, value);
    await unavailable(f.reopen());
  });
  test("detects copying ciphertext into a different target", async () => {
    const f = fixture();
    f.store.save({ provider: "custom", endpoint: CUSTOM, apiKey: KEY });
    edit(
      f.dbPath,
      "UPDATE provider_credentials SET endpoint = ?",
      "https://attacker.example.test/transcribe",
    );
    await unavailable(f.store);
  });
  test("missing master key never generates a replacement for an encrypted record", async () => {
    const f = fixture({ endpoint: GROQ_ENDPOINT, getApiKey: async () => NEXT_KEY });
    f.store.save({ provider: "groq", apiKey: KEY });
    rmSync(f.keyPath);
    await unavailable(f.reopen());
    expect(() => f.store.save({ provider: "groq", apiKey: NEXT_KEY })).toThrow(
      "Provider credentials are unavailable.",
    );
    expect(existsSync(f.keyPath)).toBe(false);
  });
  test("wrong master key fails without replacing ciphertext", async () => {
    const f = fixture();
    f.store.save({ provider: "groq", apiKey: KEY });
    const before = envelope(f.dbPath);
    writeFileSync(f.keyPath, randomBytes(32));
    await unavailable(f.reopen());
    expect(() => f.store.save({ provider: "groq", apiKey: NEXT_KEY })).toThrow();
    expect(envelope(f.dbPath)).toEqual(before);
  });
  test.each([0o644, 0o666, 0o640, 0o400, 0o4600])(
    "refuses insecure or unexpected master key mode %s",
    async (mode) => {
      const f = fixture();
      f.store.save({ provider: "groq", apiKey: KEY });
      chmodSync(f.keyPath, mode);
      await unavailable(f.store);
      expect(() => f.store.save({ provider: "groq", apiKey: NEXT_KEY })).toThrow();
      expect(lstatSync(f.keyPath).mode & 0o7777).toBe(mode);
    },
  );
  test("refuses a symlink master key without following or replacing it", async () => {
    const f = fixture();
    f.store.save({ provider: "groq", apiKey: KEY });
    const bytes = readFileSync(f.keyPath);
    const alternate = join(f.directory, "alternate.key");
    writeFileSync(alternate, bytes, { mode: 0o600 });
    rmSync(f.keyPath);
    symlinkSync(alternate, f.keyPath);
    await unavailable(f.store);
    expect(() => f.store.save({ provider: "groq", apiKey: NEXT_KEY })).toThrow();
    expect(lstatSync(f.keyPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(alternate)).toEqual(bytes);
  });
  test("refuses a hard-linked master key", async () => {
    const f = fixture();
    f.store.save({ provider: "groq", apiKey: KEY });
    linkSync(f.keyPath, join(f.directory, "hard-link.key"));
    await unavailable(f.store);
  });
  test("refuses a newly insecure master key directory", async () => {
    const f = fixture();
    f.store.save({ provider: "groq", apiKey: KEY });
    chmodSync(dirname(f.keyPath), 0o755);
    await unavailable(f.store);
    expect(lstatSync(dirname(f.keyPath)).mode & 0o777).toBe(0o755);
  });
  test("does not follow a dangling symlink during first master key creation", () => {
    const f = fixture();
    mkdirSync(dirname(f.keyPath), { mode: 0o700 });
    const missingTarget = join(f.directory, "missing.key");
    symlinkSync(missingTarget, f.keyPath);
    expect(() => f.store.save({ provider: "groq", apiKey: KEY })).toThrow();
    expect(existsSync(missingTarget)).toBe(false);
    expect(lstatSync(f.keyPath).isSymbolicLink()).toBe(true);
  });
  test("refuses a symlink key directory", () => {
    const f = fixture();
    const target = join(f.directory, "elsewhere");
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, dirname(f.keyPath));
    expect(() => f.store.save({ provider: "groq", apiKey: KEY })).toThrow();
    expect(existsSync(join(target, "master.key"))).toBe(false);
  });
  test("does not chmod or write into an insecure pre-existing directory", () => {
    const f = fixture();
    mkdirSync(dirname(f.keyPath), { mode: 0o755 });
    expect(() => f.store.save({ provider: "groq", apiKey: KEY })).toThrow();
    expect(lstatSync(dirname(f.keyPath)).mode & 0o777).toBe(0o755);
    expect(existsSync(f.keyPath)).toBe(false);
  });
  test("rejects a malformed existing key instead of replacing it", () => {
    const f = fixture();
    mkdirSync(dirname(f.keyPath), { mode: 0o700 });
    const malformed = Buffer.from("dummy-not-a-master-key");
    writeFileSync(f.keyPath, malformed, { mode: 0o600 });
    expect(() => f.store.save({ provider: "groq", apiKey: KEY })).toThrow();
    expect(readFileSync(f.keyPath)).toEqual(malformed);
  });
  test("explicit removal can recover an inaccessible encrypted entry without restoring legacy", async () => {
    const f = fixture({ endpoint: GROQ_ENDPOINT, getApiKey: async () => KEY });
    f.store.save({ provider: "groq", apiKey: KEY });
    rmSync(f.keyPath);
    f.store.save({ provider: "groq", apiKey: null });
    expect((await f.reopen().getStatus()).source).toBe("none");
    expect(existsSync(f.keyPath)).toBe(false);
  });
});
