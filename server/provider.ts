import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { dirname, parse, resolve } from "node:path";

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
type Provider = "groq" | "custom";
export interface ProviderStatus {
  provider: Provider;
  endpoint: string;
  apiKeyConfigured: boolean;
  source: "encrypted" | "legacy" | "none";
  error?: string;
}
interface Target {
  provider: Provider;
  endpoint: string;
}
interface ProviderRow extends Target {
  version: number;
  ciphertext: Uint8Array | null;
  iv: Uint8Array | null;
  tag: Uint8Array | null;
}
interface LegacyProvider {
  endpoint: string;
  getApiKey: () => Promise<string>;
}
const UNAVAILABLE = "Provider credentials are unavailable. Check the server credential store.";
const INVALID = "Invalid provider configuration.";
const MISSING = "No provider API key is configured.";

function privateLiteral(hostname: string): boolean {
  if (hostname === "[::1]") return true;
  if (isIP(hostname) !== 4) return false;
  const [a, b] = hostname.split(".").map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function normalizeEndpoint(value: unknown, legacy = false): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\?#\u0000-\u001f\u007f]/.test(value) ||
    !/^https?:\/\//i.test(value)
  ) {
    throw new Error(INVALID);
  }
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf("://") + 3).split("/")[0];
    const path = value.slice(value.indexOf("://") + 3).replace(/^[^/]*/, "");
    const decodedPath = decodeURIComponent(path);
    if (
      authority.includes("@") ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.search ||
      url.hash ||
      !path.startsWith("/") ||
      path === "/" ||
      decodedPath.includes("//") ||
      /[\\\u0000-\u0020\u007f]/.test(decodedPath) ||
      /%2f|%5c/i.test(path) ||
      decodedPath.split("/").some((part) => part === "." || part === "..") ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          (privateLiteral(url.hostname) || (legacy && url.hostname === "localhost"))
        ))
    ) {
      throw new Error(INVALID);
    }
    // URL canonicalization must not turn alternative numeric spellings into an HTTP allowlist match.
    if (url.protocol === "http:" && url.hostname !== "[::1]" && url.hostname !== "localhost") {
      if (authority.replace(/:\d+$/, "") !== url.hostname) throw new Error(INVALID);
    }
    return url.href;
  } catch {
    throw new Error(INVALID);
  }
}

function targetFor(provider: unknown, endpoint: unknown, legacy = false): Target {
  if (provider !== "groq" && provider !== "custom") throw new Error(INVALID);
  if (provider === "groq") {
    if (endpoint !== undefined && normalizeEndpoint(endpoint, legacy) !== GROQ_ENDPOINT) {
      throw new Error(INVALID);
    }
    return { provider, endpoint: GROQ_ENDPOINT };
  }
  return { provider, endpoint: normalizeEndpoint(endpoint, legacy) };
}

function validApiKey(value: unknown): string {
  if (typeof value !== "string") throw new Error(INVALID);
  const key = value.trim();
  if (!/^[\x21-\x7e]{1,4096}$/.test(key)) throw new Error(INVALID);
  return key;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function assertSafeKeyDirectory(path: string, create: boolean): void {
  const directory = dirname(path);
  // Reject symlinks anywhere in the key's parent chain, including a dangling final directory.
  const root = parse(directory).root;
  let current = root;
  for (const component of directory.slice(root.length).split("/").filter(Boolean)) {
    current = resolve(current, component);
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(UNAVAILABLE);
    } catch (error) {
      if (!create || !isMissing(error)) throw error;
      mkdirSync(current, { mode: 0o700 });
      syncDirectory(dirname(current));
    }
  }
  const stat = lstatSync(directory);
  if (
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    // Never silently chmod an existing, potentially unrelated directory.
    throw new Error(UNAVAILABLE);
  }
}

function readMasterKey(path: string): Buffer {
  assertSafeKeyDirectory(path, false);
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(UNAVAILABLE);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o7777) !== 0o600 ||
      stat.nlink !== 1 ||
      stat.size !== 32 ||
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw new Error(UNAVAILABLE);
    }
    const key = readFileSync(fd);
    if (key.length !== 32) {
      key.fill(0);
      throw new Error(UNAVAILABLE);
    }
    return key;
  } finally {
    closeSync(fd);
  }
}

function masterKey(path: string, create: boolean): Buffer {
  try {
    return readMasterKey(path);
  } catch (error) {
    if (!create || !isMissing(error)) throw new Error(UNAVAILABLE);
  }
  try {
    assertSafeKeyDirectory(path, true);
    const key = randomBytes(32);
    let fd: number | undefined;
    try {
      // Exclusive creation prevents replacing a pre-existing key, including dangling symlinks.
      fd = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(fd, key);
      fsyncSync(fd);
    } finally {
      key.fill(0);
      if (fd !== undefined) closeSync(fd);
    }
    // Persist the filename before committing any ciphertext that depends on it.
    syncDirectory(dirname(path));
    return readMasterKey(path);
  } catch {
    throw new Error(UNAVAILABLE);
  }
}

function aad(target: Target): Buffer {
  return Buffer.from(
    JSON.stringify(["opencode-voice-provider", 1, target.provider, target.endpoint]),
  );
}

function decrypt(row: ProviderRow, keyPath: string): string {
  if (!row.ciphertext || !row.iv || !row.tag) throw new Error(MISSING);
  const key = masterKey(keyPath, false);
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, row.iv, { authTagLength: 16 });
    decipher.setAAD(aad(row));
    decipher.setAuthTag(Buffer.from(row.tag));
    plaintext = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
    return validApiKey(plaintext.toString("utf8"));
  } catch {
    throw new Error(UNAVAILABLE);
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}

export function openProviderStore(dbPath: string, keyPath: string, legacy?: LegacyProvider) {
  const absoluteKeyPath = resolve(keyPath);
  let db: Database;
  try {
    db = new Database(dbPath, { create: true, strict: true });
  } catch {
    throw new Error(UNAVAILABLE);
  }
  try {
    db.run("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    // Own schema version: settings owns PRAGMA user_version in this same database.
    db.run(`CREATE TABLE IF NOT EXISTS provider_credentials (
      id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL,
      provider TEXT NOT NULL, endpoint TEXT NOT NULL,
      ciphertext BLOB, iv BLOB, tag BLOB
    )`);
    const query = db.query<ProviderRow, []>(
      "SELECT version, provider, endpoint, ciphertext, iv, tag FROM provider_credentials WHERE id = 1",
    );
    const read = (): ProviderRow | null => {
      const row = query.get();
      if (!row) return null;
      const target = targetFor(row.provider, row.endpoint);
      if (row.version !== 1 || target.endpoint !== row.endpoint) throw new Error(UNAVAILABLE);
      const removed = row.ciphertext === null && row.iv === null && row.tag === null;
      if (
        !removed &&
        (!(row.ciphertext instanceof Uint8Array) ||
          row.ciphertext.length < 1 ||
          row.ciphertext.length > 4096 ||
          !(row.iv instanceof Uint8Array) ||
          row.iv.length !== 12 ||
          !(row.tag instanceof Uint8Array) ||
          row.tag.length !== 16)
      )
        throw new Error(UNAVAILABLE);
      return row;
    };
    const legacyTarget = (): Target => {
      const endpoint = normalizeEndpoint(legacy?.endpoint, true);
      return { provider: endpoint === GROQ_ENDPOINT ? "groq" : "custom", endpoint };
    };
    const getCredentials = async (): Promise<{ endpoint: string; apiKey: string }> => {
      try {
        const row = read();
        if (row) return { endpoint: row.endpoint, apiKey: decrypt(row, absoluteKeyPath) };
        if (!legacy) throw new Error(MISSING);
        const target = legacyTarget();
        let key: string;
        try {
          key = validApiKey(await legacy.getApiKey());
        } catch {
          if (read()) return getCredentials();
          throw new Error(UNAVAILABLE);
        }
        // A concurrent save/removal takes precedence over an outstanding legacy-file read.
        if (read()) return getCredentials();
        return { endpoint: target.endpoint, apiKey: key };
      } catch (error) {
        throw new Error(
          error instanceof Error && error.message === MISSING ? MISSING : UNAVAILABLE,
        );
      }
    };
    const getStatus = async (): Promise<ProviderStatus> => {
      let status: ProviderStatus = {
        provider: "groq",
        endpoint: GROQ_ENDPOINT,
        apiKeyConfigured: false,
        source: "none",
      };
      try {
        const row = read();
        if (row) {
          status = {
            provider: row.provider,
            endpoint: row.endpoint,
            apiKeyConfigured: false,
            source: row.ciphertext === null ? "none" : "encrypted",
          };
          if (!row.ciphertext) return status;
          decrypt(row, absoluteKeyPath);
        } else if (legacy) {
          status.source = "legacy";
          status = { ...legacyTarget(), apiKeyConfigured: false, source: "legacy" };
          try {
            await getCredentials();
          } catch (error) {
            if (read()) return getStatus();
            throw error;
          }
          // Report the latest persisted state after waiting for legacy I/O.
          if (read()) return getStatus();
        } else return status;
        return { ...status, apiKeyConfigured: true };
      } catch {
        // A malformed record must never re-enable the environment/file fallback.
        try {
          if (query.get()) status.source = "encrypted";
        } catch {
          /* Preserve safe metadata. */
        }
        return { ...status, error: UNAVAILABLE };
      }
    };
    return {
      getStatus,
      getCredentials,
      save(value: unknown): void {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
        const input = value as Record<string, unknown>;
        if (Object.keys(input).some((key) => !["provider", "endpoint", "apiKey"].includes(key))) {
          throw new Error(INVALID);
        }
        const target = targetFor(input.provider, input.endpoint);
        const hasKey = Object.hasOwn(input, "apiKey");
        const remove = hasKey && input.apiKey === null;
        const newKey = hasKey && !remove ? validApiKey(input.apiKey) : undefined;
        try {
          db.transaction(() => {
            // Explicit removal is the recovery path for corrupt metadata as well as a lost key.
            const current = remove ? null : read();
            const same =
              current?.provider === target.provider && current.endpoint === target.endpoint;
            if (!same && !newKey && !remove) {
              throw new Error("Enter an API key for a new or changed provider endpoint.");
            }
            if (!hasKey) {
              // A legacy key is never silently migrated or copied; re-entry establishes encrypted storage.
              if (!current?.ciphertext || !same)
                throw new Error("Enter an API key to save provider settings.");
            }
            const apiKey = remove
              ? undefined
              : (newKey ?? (current ? decrypt(current, absoluteKeyPath) : undefined));
            let ciphertext: Buffer | null = null;
            let iv: Buffer | null = null;
            let tag: Buffer | null = null;
            if (apiKey) {
              // Validate existing ciphertext before replacement, so losing/replacing its key cannot silently reset it.
              if (current?.ciphertext && newKey) decrypt(current, absoluteKeyPath);
              const key = masterKey(absoluteKeyPath, !current?.ciphertext);
              try {
                iv = randomBytes(12);
                const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
                cipher.setAAD(aad(target));
                ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
                tag = cipher.getAuthTag();
              } finally {
                key.fill(0);
              }
            }
            db.query(`INSERT INTO provider_credentials (id, version, provider, endpoint, ciphertext, iv, tag)
              VALUES (1, 1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
              version = 1, provider = excluded.provider, endpoint = excluded.endpoint,
              ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag`).run(
              target.provider,
              target.endpoint,
              ciphertext,
              iv,
              tag,
            );
          }).immediate();
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("Enter an API key")) throw error;
          throw new Error(UNAVAILABLE);
        }
      },
      close: () => db.close(),
    };
  } catch {
    db.close();
    throw new Error(UNAVAILABLE);
  }
}
export type ProviderStore = ReturnType<typeof openProviderStore>;
