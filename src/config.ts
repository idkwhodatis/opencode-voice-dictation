import { GM_getValue, GM_registerMenuCommand, GM_setValue } from "$";
import type { AppConfig } from "./types.js";

export const DEFAULTS: AppConfig = {
  groqApiKey: "",
  model: "whisper-large-v3",
  language: "",
  whisperPrompt: "",
  endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
  temperature: 0,
  autoSubmit: false,
};

export function getConfig(): AppConfig {
  return {
    groqApiKey: GM_getValue("groqApiKey", DEFAULTS.groqApiKey),
    model: GM_getValue("model", DEFAULTS.model),
    language: GM_getValue("language", DEFAULTS.language),
    whisperPrompt: GM_getValue("whisperPrompt", DEFAULTS.whisperPrompt),
    endpoint: GM_getValue("endpoint", DEFAULTS.endpoint),
    temperature: GM_getValue("temperature", DEFAULTS.temperature),
    autoSubmit: GM_getValue("autoSubmit", DEFAULTS.autoSubmit),
  };
}

export function setConfig(partial: Partial<AppConfig>): void {
  for (const [key, value] of Object.entries(partial)) {
    GM_setValue(key, value);
  }
}

export function validateApiKey(key: string): boolean {
  return key.startsWith("gsk_") && key.length > 20;
}

export function isFirstRun(): boolean {
  return GM_getValue("groqApiKey", "") === "";
}

export function registerMenuCommands(callbacks: {
  onSetKey: () => void;
  onToggleAutoSubmit: () => void;
  onSetModel: () => void;
  onSetLanguage: () => void;
  onSetPrompt: () => void;
  onSetEndpoint: () => void;
  onSetTemperature: () => void;
}): void {
  GM_registerMenuCommand("Set Groq API Key", callbacks.onSetKey);
  GM_registerMenuCommand("Toggle Auto-Submit", callbacks.onToggleAutoSubmit);
  GM_registerMenuCommand("Set Whisper Model", callbacks.onSetModel);
  GM_registerMenuCommand("Set Language", callbacks.onSetLanguage);
  GM_registerMenuCommand("Set Whisper Prompt", callbacks.onSetPrompt);
  GM_registerMenuCommand("Set STT Endpoint", callbacks.onSetEndpoint);
  GM_registerMenuCommand("Set Temperature", callbacks.onSetTemperature);
}
