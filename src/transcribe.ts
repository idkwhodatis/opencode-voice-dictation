import { GM_xmlhttpRequest } from "$";
import type { AppConfig, TranscriptionResult } from "./types.js";

export function buildFormData(audioBlob: Blob, config: AppConfig): FormData {
  const formData = new FormData();
  const extension = audioBlob.type.includes("mp4")
    ? "mp4"
    : audioBlob.type.includes("ogg")
      ? "ogg"
      : "webm";
  formData.append("file", audioBlob, `audio.${extension}`);
  formData.append("model", config.model);
  formData.append("response_format", "text");
  formData.append("temperature", String(config.temperature));
  if (config.language) {
    formData.append("language", config.language);
  }
  if (config.whisperPrompt) {
    formData.append("prompt", config.whisperPrompt);
  }
  return formData;
}

export function parseErrorResponse(status: number, _body: string): string {
  if (status === 401) {
    return "Invalid API key. Check your Groq API key in settings.";
  }
  if (status === 429) {
    return "Rate limit exceeded. Please wait and try again.";
  }
  if (status >= 500) {
    return "Groq server error. Please try again later.";
  }
  // Do not echo untrusted endpoint responses into the page (they can contain secrets).
  return `Transcription failed (HTTP ${status}). Check endpoint settings.`;
}

export function transcribe(
  audioBlob: Blob,
  config: AppConfig,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    if (!config.groqApiKey) {
      reject(new Error("Groq API key not set. Use the Tampermonkey/Violentmonkey menu to set it."));
      return;
    }
    if (audioBlob.size === 0 || audioBlob.size > 25 * 1024 * 1024) {
      reject(
        new Error(
          audioBlob.size === 0
            ? "No audio recorded. Please try again."
            : "Recording exceeds 25 MB. Record a shorter clip.",
        ),
      );
      return;
    }
    if (signal?.aborted) {
      reject(new Error("Transcription cancelled"));
      return;
    }
    let settled = false;
    let request: { abort: () => void } | undefined;
    const finish = (error?: string, text = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(new Error(error));
      else resolve({ text });
    };
    const abort = () => {
      finish("Transcription cancelled");
      request?.abort();
    };
    // Keep a local watchdog too: some userscript/browser modes ignore timeout.
    const timer = setTimeout(() => {
      finish("Request timeout: Groq API did not respond");
      request?.abort();
    }, 60000);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      request = GM_xmlhttpRequest({
        method: "POST",
        url: config.endpoint,
        timeout: 60000,
        headers: { Authorization: `Bearer ${config.groqApiKey}` },
        data: buildFormData(audioBlob, config),
        onload: (response) => {
          if (response.status === 200) finish(undefined, response.responseText.trim());
          else finish(parseErrorResponse(response.status, response.responseText));
        },
        onerror: () => finish("Network error: could not reach Groq API"),
        ontimeout: () => finish("Request timeout: Groq API did not respond"),
        onabort: () => finish("Transcription cancelled"),
      });
    } catch {
      finish("Could not start transcription request. Check userscript permissions.");
    }
  });
}
