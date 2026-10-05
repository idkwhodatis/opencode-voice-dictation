// A separate distribution: reuse the tested userscript DOM/audio modules, not GM APIs.
import { type AudioRecorder, createAudioRecorder } from "../src/audio";
import {
  type InputTarget, type InsertTarget, captureTarget,
  isCurrentTarget, isQuestionPromptOpen,
} from "../src/insert";
import { setupKeyboardShortcut } from "../src/keyboard";
import { setupUI } from "../src/ui";
import type { DictationState } from "../src/types";
import type { VoiceSettings } from "./settings";
import { createServerControls } from "./controls";
import { createCaretTracker, insertAtCaret } from "./caret";
import { draftSnapshot, sendDraft } from "./send";

type FinishAction = "review" | "send";
interface Config {
  settings: VoiceSettings;
  apiKeyConfigured: boolean;
  maxAudioBytes: number;
  maxRecordingSeconds: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/voice/${path}`, {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { "X-OCVD-Request": "1", ...init.headers },
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Voice service did not return JSON. Check your Caddy route and sign-in.");
  }
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : `Voice request failed (${response.status}).`);
  return value as T;
}

function start() {
  const marker = "data-ocvd-initialized";
  if (document.documentElement.hasAttribute(marker)) return;
  document.documentElement.setAttribute(marker, "server");
  const caret = createCaretTracker();
  let recorder: AudioRecorder | null = null;
  let target: InputTarget | null = null;
  let controller: AbortController | null = null;
  let state: DictationState = "idle";
  let generation = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let startedAt = 0;
  let lastElapsed = -1;
  let config: Config | null = null;
  let ui: ReturnType<typeof setupUI>;
  let controls: ReturnType<typeof createServerControls> | undefined;

  const setState = (next: DictationState) => {
    state = next;
    ui.updateState(next);
    controls?.update(next, target?.kind);
  };
  function reset() {
    clearInterval(ticker);
    ticker = undefined;
    recorder = null;
    target = null;
    controller = null;
    config = null;
    lastElapsed = -1;
    setState("idle");
  }
  function cancel() {
    generation++;
    recorder?.cancel();
    controller?.abort();
    reset();
  }
  function checkTarget() {
    if (target && !isCurrentTarget(target)) {
      cancel();
      ui.toast("Session or input changed. Dictation cancelled.");
    }
  }
  async function finish(action: FinishAction) {
    // Latch one action per recording before awaiting anything (double taps/timer races).
    if (state !== "recording") return;
    const captured = target;
    const audio = recorder;
    const limits = config;
    const activeController = controller;
    if (!captured || !audio || !limits || !activeController || !isCurrentTarget(captured)) { cancel(); return; }
    const own = generation;
    const insertion = caret.freeze(captured);
    const originalDraft = draftSnapshot(captured);
    let edited = false;
    const onEdit = () => { edited = true; };
    captured.editor.addEventListener("input", onEdit);
    setState("processing");
    try {
      const blob = await audio.stop();
      if (own !== generation || !isCurrentTarget(captured)) return;
      if (!blob.size) throw new Error("Recording was empty. Please try again.");
      if (blob.size > limits.maxAudioBytes) throw new Error("Recording is too large. Try a shorter recording.");
      // autoSubmit remains in the legacy REST response but never overrides this explicit action.
      const result = await request<{ text: string }>("transcribe", {
        method: "POST", headers: { "Content-Type": blob.type }, body: blob,
        signal: AbortSignal.any([activeController.signal, AbortSignal.timeout(330000)]),
      });
      if (own !== generation || !isCurrentTarget(captured)) return;
      if (typeof result.text !== "string") throw new Error("Invalid transcript response.");
      const draftChanged = edited || draftSnapshot(captured) !== originalDraft;
      captured.editor.removeEventListener("input", onEdit);
      if (!result.text.trim()) ui.toast("No speech detected. Please try again.");
      else {
        const inserted = insertAtCaret(result.text, captured, insertion, draftChanged);
        if (!inserted.inserted) ui.toast("Original input is no longer available. Dictation discarded.", true);
        else if (inserted.fallback) {
          ui.toast("Draft changed or saved cursor unavailable. Text appended for review; send manually.");
        } else if (action === "send" && captured.kind === "composer") {
          const outcome = await sendDraft(captured, activeController.signal);
          if (own === generation && outcome === "unavailable") ui.toast("Text inserted. Send is unavailable; review and send manually.");
          else if (own === generation && outcome === "changed") ui.toast("Draft changed. Automatic sending cancelled; review it before sending.");
        }
      }
    } catch (error) {
      if (own === generation && !activeController.signal.aborted) ui.toast(error instanceof Error ? error.message : "Transcription failed.", true);
    } finally {
      captured.editor.removeEventListener("input", onEdit);
      if (own === generation) reset();
    }
  }
  async function toggle(kind: InsertTarget) {
    if (state === "recording") { await finish("review"); return; }
    if (state !== "idle") return;
    const captured = captureTarget(kind);
    if (!captured) return;
    target = captured;
    const own = ++generation;
    const activeController = new AbortController();
    controller = activeController;
    const audio = createAudioRecorder((message) => {
      if (own !== generation) return;
      cancel(); ui.toast(message, true);
    });
    recorder = audio;
    setState("starting");
    ticker = setInterval(() => {
      checkTarget();
      if (state === "recording") {
        const elapsed = Math.floor((performance.now() - startedAt) / 1000);
        if (elapsed !== lastElapsed) {
          lastElapsed = elapsed;
          ui.updateState(state, elapsed);
          controls?.update(state, target?.kind);
        }
        // A duration limit is not an explicit request to send a message.
        if (config && elapsed >= config.maxRecordingSeconds) void finish("review");
      }
    }, 250);
    try {
      // Request microphone permission directly in the tap handler, before awaiting HTTP.
      const [next] = await Promise.all([
        request<Config>("config", { signal: AbortSignal.any([activeController.signal, AbortSignal.timeout(10000)]) }),
        audio.start(),
      ]);
      if (own !== generation) return;
      if (!isCurrentTarget(captured)) { cancel(); return; }
      if (!next.apiKeyConfigured) throw new Error("The server API key is not configured. Check the key file on your server.");
      if (!Number.isFinite(next.maxAudioBytes) || next.maxAudioBytes <= 0 ||
        !Number.isFinite(next.maxRecordingSeconds) || next.maxRecordingSeconds <= 0) throw new Error("Invalid voice service configuration.");
      config = next;
      startedAt = performance.now();
      setState("recording");
    } catch (error) {
      if (own !== generation) return;
      cancel();
      ui.toast(error instanceof Error ? error.message : "Could not start dictation.", true);
    }
  }
  ui = setupUI({ onToggle: (kind) => { void toggle(kind); }, onCancel: cancel, onContextChange: checkTarget });
  controls = createServerControls(() => { void finish("send"); });
  setupKeyboardShortcut(() => { void toggle(isQuestionPromptOpen() ? "question" : "composer"); });
  window.addEventListener("pagehide", cancel);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
