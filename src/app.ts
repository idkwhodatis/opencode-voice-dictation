import { type AudioRecorder, createAudioRecorder } from "./audio.js";
import {
  DEFAULTS,
  getConfig,
  isFirstRun,
  registerMenuCommands,
  setConfig,
  validateApiKey,
  validateEndpoint,
} from "./config.js";

const DEFAULTS_ENDPOINT = DEFAULTS.endpoint;
import {
  type InputTarget,
  type InsertTarget,
  captureTarget,
  insertText,
  isCurrentTarget,
  isQuestionPromptOpen,
  submitPrompt,
} from "./insert.js";
import { setupKeyboardShortcut } from "./keyboard.js";
import { transcribe } from "./transcribe.js";
import type { DictationState } from "./types.js";
import { setupUI } from "./ui.js";

let recorder: AudioRecorder | null = null;
let currentState: DictationState = "idle";
let timerInterval: ReturnType<typeof setInterval> | null = null;
let elapsedSeconds = 0;
let ui: ReturnType<typeof setupUI> | null = null;
let currentTarget: InputTarget | null = null;
let generation = 0;
let request: AbortController | null = null;

function setState(state: DictationState): void {
  currentState = state;
  ui?.updateState(state, elapsedSeconds);
}

function reset(): void {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  elapsedSeconds = 0;
  recorder = null;
  currentTarget = null;
  request = null;
  setState("idle");
}

function cancelRecording(): void {
  generation++;
  recorder?.cancel();
  request?.abort();
  reset();
}

async function toggleDictation(kind: InsertTarget): Promise<void> {
  if (currentState === "recording") {
    await stopAndTranscribe();
    return;
  }
  if (currentState !== "idle") return;
  const target = captureTarget(kind);
  if (!target) return;
  if (!getConfig().groqApiKey) {
    ui?.toast("Set your Groq API key in the Tampermonkey menu first.", true);
    return;
  }
  currentTarget = target;
  const ownGeneration = ++generation;
  const activeRecorder = createAudioRecorder((message) => {
    if (ownGeneration !== generation) return;
    cancelRecording();
    ui?.toast(message, true);
  });
  recorder = activeRecorder;
  setState("starting");
  try {
    await activeRecorder.start();
    if (ownGeneration !== generation) return;
    if (!isCurrentTarget(target)) {
      cancelRecording();
      return;
    }
    setState("recording");
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      ui?.updateState(currentState, elapsedSeconds);
    }, 1000);
  } catch (error) {
    if (ownGeneration !== generation) return;
    activeRecorder.cancel();
    reset();
    ui?.toast(error instanceof Error ? error.message : "Failed to access microphone", true);
  }
}

async function stopAndTranscribe(): Promise<void> {
  const activeRecorder = recorder;
  const target = currentTarget;
  if (!activeRecorder || !target || !isCurrentTarget(target)) {
    cancelRecording();
    return;
  }
  const ownGeneration = generation;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  const controller = new AbortController();
  request = controller;
  setState("processing");
  try {
    const audioBlob = await activeRecorder.stop();
    if (ownGeneration !== generation || !isCurrentTarget(target)) return;
    const config = getConfig();
    const result = await transcribe(audioBlob, config, controller.signal);
    if (ownGeneration !== generation || !isCurrentTarget(target)) return;
    if (!result.text) {
      ui?.toast("No speech detected. Please try again.");
    } else if (!insertText(result.text, target)) {
      ui?.toast("The original input is no longer available. Dictation discarded.", true);
    } else if (config.autoSubmit && target.kind === "composer") {
      // Let OpenCode's input handler update the Send/Stop state before clicking.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (ownGeneration === generation && !submitPrompt(target)) {
        ui?.toast("Text appended. Auto-submit skipped because Send is unavailable.");
      }
    }
  } catch (error) {
    if (ownGeneration === generation && !controller.signal.aborted) {
      ui?.toast(error instanceof Error ? error.message : "Transcription failed", true);
    }
  } finally {
    if (ownGeneration === generation) reset();
  }
}

function promptForApiKey(): void {
  const key = prompt("Enter your Groq API key (get one free at console.groq.com/keys):", "");
  if (key !== null && (!key.trim() || validateApiKey(key.trim()))) {
    setConfig({ groqApiKey: key.trim() });
    ui?.toast(key.trim() ? "API key saved!" : "API key cleared");
  } else if (key) {
    ui?.toast("Invalid key format. Must start with 'gsk_'", true);
  }
}

function promptForModel(): void {
  const model = prompt(
    "Whisper model (whisper-large-v3 or whisper-large-v3-turbo):",
    getConfig().model,
  );
  if (model && (model === "whisper-large-v3" || model === "whisper-large-v3-turbo")) {
    setConfig({ model });
    ui?.toast(`Model set to ${model}`);
  } else if (model) {
    ui?.toast("Invalid model name", true);
  }
}

function promptForLanguage(): void {
  const lang = prompt(
    "Language code (empty for auto-detect, e.g. 'ru', 'en'):",
    getConfig().language,
  );
  if (lang !== null) {
    setConfig({ language: lang.trim() });
    ui?.toast(lang.trim() ? `Language set to ${lang}` : "Auto-detect enabled");
  }
}

function promptForWhisperPrompt(): void {
  const text = prompt("Whisper prompt (context for transcription):", getConfig().whisperPrompt);
  if (text !== null) {
    setConfig({ whisperPrompt: text });
    ui?.toast("Whisper prompt updated");
  }
}

function promptForEndpoint(): void {
  const current = getConfig().endpoint;
  const url = prompt("STT endpoint URL:", current);
  if (url === null) {
    return;
  }
  const trimmed = url.trim();
  const value = trimmed || DEFAULTS_ENDPOINT;
  if (!validateEndpoint(value)) {
    ui?.toast("Use an HTTPS endpoint without credentials or a URL fragment.", true);
    return;
  }
  if (
    value !== current &&
    !confirm(
      `Recordings and your API key will be sent to ${new URL(value).origin}. Only use a proxy you trust. Save endpoint?`,
    )
  )
    return;
  setConfig({ endpoint: value });
  ui?.toast("Endpoint saved");
}

function promptForTemperature(): void {
  const current = getConfig().temperature;
  const input = prompt("Temperature (0-1):", String(current));
  if (input === null) {
    return;
  }
  const parsed = Number(input);
  if (Number.isNaN(parsed)) {
    ui?.toast("Invalid temperature", true);
    return;
  }
  const clamped = Math.min(1, Math.max(0, parsed));
  setConfig({ temperature: clamped });
  ui?.toast(`Temperature set to ${clamped}`);
}

function toggleAutoSubmit(): void {
  const config = getConfig();
  setConfig({ autoSubmit: !config.autoSubmit });
  ui?.toast(`Auto-submit ${!config.autoSubmit ? "enabled" : "disabled"}`);
}

function checkFirstRun(): ReturnType<typeof setTimeout> | undefined {
  if (isFirstRun()) {
    return setTimeout(() => {
      ui?.toast("First run: Set your Groq API key via the Violentmonkey/Tampermonkey menu");
    }, 2000);
  }
}

export function startApp(): () => void {
  const marker = "data-ocvd-initialized";
  if (document.documentElement.hasAttribute(marker)) return () => {};
  document.documentElement.setAttribute(marker, "true");
  ui = setupUI({
    onToggle: (target) => {
      void toggleDictation(target);
    },
    onCancel: cancelRecording,
    onContextChange: () => {
      if (currentTarget && !isCurrentTarget(currentTarget)) {
        cancelRecording();
        ui?.toast("Session or composer changed. Dictation cancelled.");
      }
    },
  });
  const removeShortcut = setupKeyboardShortcut(() => {
    void toggleDictation(isQuestionPromptOpen() ? "question" : "composer");
  });
  window.addEventListener("pagehide", cancelRecording);
  registerMenuCommands({
    onSetKey: promptForApiKey,
    onToggleAutoSubmit: toggleAutoSubmit,
    onSetModel: promptForModel,
    onSetLanguage: promptForLanguage,
    onSetPrompt: promptForWhisperPrompt,
    onSetEndpoint: promptForEndpoint,
    onSetTemperature: promptForTemperature,
  });
  const firstRunTimer = checkFirstRun();
  return () => {
    cancelRecording();
    clearTimeout(firstRunTimer);
    removeShortcut();
    window.removeEventListener("pagehide", cancelRecording);
    ui?.destroy();
    document.documentElement.removeAttribute(marker);
  };
}
