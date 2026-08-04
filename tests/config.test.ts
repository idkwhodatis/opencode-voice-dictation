import { describe, expect, it, vi } from "vitest";

vi.mock("$", () => ({
  GM_getValue: vi.fn((key: string, defaultValue: unknown) => defaultValue),
  GM_setValue: vi.fn(),
  GM_registerMenuCommand: vi.fn(),
  GM_xmlhttpRequest: vi.fn(),
}));

import { GM_getValue, GM_registerMenuCommand, GM_setValue } from "$";
import {
  DEFAULTS,
  getConfig,
  isFirstRun,
  registerMenuCommands,
  setConfig,
  validateApiKey,
} from "../src/config.js";

describe("DEFAULTS", () => {
  it("should have whisper-large-v3 as default model", () => {
    expect(DEFAULTS.model).toBe("whisper-large-v3");
  });

  it("should have empty language for auto-detect", () => {
    expect(DEFAULTS.language).toBe("");
  });

  it("should have empty whisperPrompt by default", () => {
    expect(DEFAULTS.whisperPrompt).toBe("");
  });

  it("should have autoSubmit disabled by default", () => {
    expect(DEFAULTS.autoSubmit).toBe(false);
  });

  it("should have default Groq endpoint", () => {
    expect(DEFAULTS.endpoint).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  });

  it("should have temperature 0 by default", () => {
    expect(DEFAULTS.temperature).toBe(0);
  });
});

describe("validateApiKey", () => {
  it("should accept valid key with gsk_ prefix", () => {
    expect(validateApiKey("gsk_test_fake_key_1234567890abcdef")).toBe(true);
  });

  it("should reject key without gsk_ prefix", () => {
    expect(validateApiKey("sk_test_key_12345")).toBe(false);
  });

  it("should reject key that is too short", () => {
    expect(validateApiKey("gsk_short")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(validateApiKey("")).toBe(false);
  });
});

describe("getConfig", () => {
  it("should return defaults when GM storage is empty", () => {
    vi.mocked(GM_getValue).mockImplementation((key: string, def: unknown) => def);

    const config = getConfig();
    expect(config.model).toBe(DEFAULTS.model);
    expect(config.language).toBe(DEFAULTS.language);
    expect(config.groqApiKey).toBe("");
  });

  it("should return stored values when present", () => {
    vi.mocked(GM_getValue).mockImplementation((key: string, def: unknown) => {
      if (key === "groqApiKey") {
        return "gsk_stored_key";
      }
      if (key === "model") {
        return "whisper-large-v3-turbo";
      }
      return def;
    });

    const config = getConfig();
    expect(config.groqApiKey).toBe("gsk_stored_key");
    expect(config.model).toBe("whisper-large-v3-turbo");
  });
});

describe("isFirstRun", () => {
  it("should return true when no API key stored", () => {
    vi.mocked(GM_getValue).mockReturnValue("");
    expect(isFirstRun()).toBe(true);
  });

  it("should return false when API key is stored", () => {
    vi.mocked(GM_getValue).mockReturnValue("gsk_stored_key");
    expect(isFirstRun()).toBe(false);
  });
});

describe("setConfig", () => {
  it("should call GM_setValue for each key", () => {
    setConfig({ groqApiKey: "gsk_new", model: "whisper-large-v3-turbo" });
    expect(GM_setValue).toHaveBeenCalledWith("groqApiKey", "gsk_new");
    expect(GM_setValue).toHaveBeenCalledWith("model", "whisper-large-v3-turbo");
  });
});

describe("registerMenuCommands", () => {
  it("should register all menu commands", () => {
    const callbacks = {
      onSetKey: () => {},
      onToggleAutoSubmit: () => {},
      onSetModel: () => {},
      onSetLanguage: () => {},
      onSetPrompt: () => {},
      onSetEndpoint: () => {},
      onSetTemperature: () => {},
    };
    registerMenuCommands(callbacks);
    expect(GM_registerMenuCommand).toHaveBeenCalledTimes(7);
  });
});
