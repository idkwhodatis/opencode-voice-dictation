import { Database } from "bun:sqlite";

export interface RuntimeLimits {
  maxAudioMB: number;
  maxRecordingSeconds: number;
  timeoutSeconds: number;
  maxConcurrent: number;
  requestsPerMinute: number;
}

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  maxAudioMB: 20,
  maxRecordingSeconds: 300,
  timeoutSeconds: 60,
  maxConcurrent: 2,
  requestsPerMinute: 10,
};

const RUNTIME_LIMIT_RANGES: Record<keyof RuntimeLimits, [number, number]> = {
  maxAudioMB: [1, 100],
  maxRecordingSeconds: [1, 3600],
  timeoutSeconds: [1, 300],
  maxConcurrent: [1, 16],
  requestsPerMinute: [1, 1000],
};
const RUNTIME_LIMIT_KEYS = Object.keys(DEFAULT_RUNTIME_LIMITS) as (keyof RuntimeLimits)[];

export interface VoiceSettings extends RuntimeLimits {
  model: string;
  language: string;
  whisperPrompt: string;
  temperature: number;
  autoSubmit: boolean;
}

export const DEFAULT_SETTINGS: VoiceSettings = {
  ...DEFAULT_RUNTIME_LIMITS,
  model: "whisper-large-v3-turbo",
  language: "",
  whisperPrompt: "",
  temperature: 0,
  autoSubmit: false,
};

export function validatePatch(value: unknown): Partial<VoiceSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Settings must be a JSON object.");
  }
  const patch: Partial<VoiceSettings> = {};
  for (const [key, item] of Object.entries(value)) {
    switch (key) {
      case "model":
        if (typeof item !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(item)) {
          throw new Error("model must be a model ID of 1–128 characters.");
        }
        patch.model = item;
        break;
      case "language":
        if (typeof item !== "string" || !/^(?:[a-z]{2,3})?$/.test(item)) {
          throw new Error("language must be empty (auto-detect) or a lowercase language code.");
        }
        patch.language = item;
        break;
      case "whisperPrompt":
        if (typeof item !== "string" || item.length > 2000 || item.includes("\0")) {
          throw new Error("whisperPrompt must be a string of at most 2000 characters.");
        }
        patch.whisperPrompt = item;
        break;
      case "temperature":
        if (typeof item !== "number" || !Number.isFinite(item) || item < 0 || item > 1) {
          throw new Error("temperature must be a number between 0 and 1.");
        }
        patch.temperature = item;
        break;
      case "autoSubmit":
        if (typeof item !== "boolean") throw new Error("autoSubmit must be a boolean.");
        patch.autoSubmit = item;
        break;
      case "maxAudioMB":
      case "maxRecordingSeconds":
      case "timeoutSeconds":
      case "maxConcurrent":
      case "requestsPerMinute": {
        const [min, max] = RUNTIME_LIMIT_RANGES[key];
        if (typeof item !== "number" || !Number.isInteger(item) || item < min || item > max) {
          throw new Error(`${key} must be an integer from ${min} to ${max}.`);
        }
        patch[key] = item;
        break;
      }
      default:
        // Do not permit arbitrary endpoints, filesystem paths, or secrets via REST.
        throw new Error("Unknown settings field. Only transcription, UI, and runtime limit settings are accepted.");
    }
  }
  return patch;
}

export function openSettings(path: string, initialRuntimeLimits: Partial<RuntimeLimits> = {}) {
  // Legacy environment values are migration seeds, never startup overrides.
  // Once saved (including through the web UI), a limit belongs to SQLite.
  for (const key of Object.keys(initialRuntimeLimits)) {
    if (!Object.hasOwn(DEFAULT_RUNTIME_LIMITS, key)) throw new Error("Unknown initial runtime limit.");
  }
  const initial = { ...DEFAULT_RUNTIME_LIMITS, ...validatePatch(initialRuntimeLimits) };
  const db = new Database(path, { create: true, strict: true });
  try {
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    if ((version?.user_version ?? 0) > 1) throw new Error("Unsupported settings database version.");
    db.run("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    db.transaction(() => {
      db.run("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)");
      const row = db.query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1").get();
      if (!row) {
        db.query("INSERT INTO settings (id, value) VALUES (1, ?)").run(JSON.stringify({ ...DEFAULT_SETTINGS, ...initial }));
      } else {
        // Validate before writing anything so corrupt/unknown fields are never discarded.
        const current = validatePatch(JSON.parse(row.value));
        const missing: Partial<RuntimeLimits> = {};
        for (const key of RUNTIME_LIMIT_KEYS) {
          if (!Object.hasOwn(current, key)) missing[key] = initial[key];
        }
        if (Object.keys(missing).length) {
          db.query("UPDATE settings SET value = ? WHERE id = 1").run(JSON.stringify({ ...current, ...missing }));
        }
      }
      db.run("PRAGMA user_version = 1");
    })();
    const get = (): VoiceSettings => {
      const row = db.query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1").get();
      if (!row) throw new Error("Missing settings row.");
      return { ...DEFAULT_SETTINGS, ...validatePatch(JSON.parse(row.value)) };
    };
    get(); // Fail on corrupt state instead of silently replacing the user's settings.
    return {
      get,
      patch(value: unknown): VoiceSettings {
        const patch = validatePatch(value);
        return db.transaction(() => {
          const next = { ...get(), ...patch };
          db.query("UPDATE settings SET value = ? WHERE id = 1").run(JSON.stringify(next));
          return next;
        })();
      },
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
export type SettingsStore = ReturnType<typeof openSettings>;
