import { Database } from "bun:sqlite";

export interface VoiceSettings {
  model: string;
  language: string;
  whisperPrompt: string;
  temperature: number;
  autoSubmit: boolean;
}

export const DEFAULT_SETTINGS: VoiceSettings = {
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
      default:
        // Do not permit arbitrary endpoints, filesystem paths, or secrets via REST.
        throw new Error("Unknown settings field. Only transcription and UI settings are accepted.");
    }
  }
  return patch;
}

export function openSettings(path: string) {
  const db = new Database(path, { create: true, strict: true });
  try {
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    if ((version?.user_version ?? 0) > 1) throw new Error("Unsupported settings database version.");
    db.run("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    db.transaction(() => {
      db.run("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)");
      db.query("INSERT OR IGNORE INTO settings (id, value) VALUES (1, ?)").run(JSON.stringify(DEFAULT_SETTINGS));
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
