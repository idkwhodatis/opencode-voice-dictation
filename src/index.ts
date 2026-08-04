import { type AudioRecorder, createAudioRecorder } from "./audio.js";
import {
  DEFAULTS,
  getConfig,
  isFirstRun,
  registerMenuCommands,
  setConfig,
  validateApiKey,
} from "./config.js";

const DEFAULTS_ENDPOINT = DEFAULTS.endpoint;
import {
  type InsertTarget,
  insertText,
  isOpencodePage,
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
let currentTarget: InsertTarget = "composer";

function startTimer(): void {
  elapsedSeconds = 0;
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    ui?.updateState(currentState, elapsedSeconds);
  }, 1000);
}

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function toggleDictation(target: InsertTarget): Promise<void> {
  if (currentState === "idle") {
    currentTarget = target;
    await startRecording();
  } else if (currentState === "recording") {
    await stopAndTranscribe();
  }
}

async function startRecording(): Promise<void> {
  try {
    recorder = createAudioRecorder();
    await recorder.start();
    currentState = "recording";
    startTimer();
    ui?.updateState(currentState, elapsedSeconds);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to access microphone";
    ui?.toast(message, true);
    recorder = null;
  }
}

async function stopAndTranscribe(): Promise<void> {
  if (!recorder) {
    return;
  }

  stopTimer();
  currentState = "processing";
  ui?.updateState(currentState);

  try {
    const audioBlob = await recorder.stop();
    const config = getConfig();

    const result = await transcribe(audioBlob, config);

    if (result.text) {
      const inserted = insertText(result.text, currentTarget);
      if (!inserted) {
        ui?.toast("Could not find input field", true);
      } else if (config.autoSubmit && currentTarget === "composer") {
        submitPrompt();
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    ui?.toast(message, true);
  } finally {
    currentState = "idle";
    elapsedSeconds = 0;
    recorder = null;
    ui?.updateState(currentState);
  }
}

async function cancelRecording(): Promise<void> {
  if (currentState !== "recording" || !recorder) {
    return;
  }

  stopTimer();

  try {
    await recorder.stop();
  } catch {
    // discard audio
  }

  currentState = "idle";
  elapsedSeconds = 0;
  recorder = null;
  ui?.updateState(currentState);
}

function promptForApiKey(): void {
  const key = prompt("Enter your Groq API key (get one free at console.groq.com/keys):", "");
  if (key && validateApiKey(key)) {
    setConfig({ groqApiKey: key.trim() });
    ui?.toast("API key saved!");
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
  setConfig({ endpoint: value });
  ui?.toast(`Endpoint set to ${value}`);
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

function checkFirstRun(): void {
  if (isFirstRun()) {
    setTimeout(() => {
      ui?.toast("First run: Set your Groq API key via the Violentmonkey/Tampermonkey menu");
    }, 2000);
  }
}

function init(): void {
  if (!isOpencodePage()) {
    console.log("[ocvd] OpenCode page not detected, retrying in 1.5s...");
    setTimeout(init, 1500);
    return;
  }
  console.log("[ocvd] OpenCode page detected, setting up UI");

  ui = setupUI({
    onToggle: (target: InsertTarget) => {
      void toggleDictation(target);
    },
    onCancel: () => {
      void cancelRecording();
    },
  });

  setupKeyboardShortcut(() => {
    void toggleDictation(isQuestionPromptOpen() ? "question" : "composer");
  });

  registerMenuCommands({
    onSetKey: promptForApiKey,
    onToggleAutoSubmit: toggleAutoSubmit,
    onSetModel: promptForModel,
    onSetLanguage: promptForLanguage,
    onSetPrompt: promptForWhisperPrompt,
    onSetEndpoint: promptForEndpoint,
    onSetTemperature: promptForTemperature,
  });

  checkFirstRun();
}

init();
