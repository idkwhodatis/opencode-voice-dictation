import { GM_xmlhttpRequest } from "$";
import type { AppConfig, TranscriptionResult } from "./types.js";

export function buildFormData(audioBlob: Blob, config: AppConfig): FormData {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
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

export function parseErrorResponse(status: number, body: string): string {
  if (status === 401) {
    return "Invalid API key. Check your Groq API key in settings.";
  }
  if (status === 429) {
    return "Rate limit exceeded. Please wait and try again.";
  }
  if (status >= 500) {
    return "Groq server error. Please try again later.";
  }
  try {
    const error = JSON.parse(body);
    return error?.error?.message ?? `Error ${status}`;
  } catch {
    return `Error ${status}: ${body}`;
  }
}

export function transcribe(audioBlob: Blob, config: AppConfig): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    if (!config.groqApiKey) {
      reject(new Error("Groq API key not set. Use the Tampermonkey/Violentmonkey menu to set it."));
      return;
    }

    if (audioBlob.size === 0) {
      reject(new Error("No audio recorded. Please try again."));
      return;
    }

    const formData = buildFormData(audioBlob, config);

    GM_xmlhttpRequest({
      method: "POST",
      url: config.endpoint,
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
      },
      data: formData,
      onload: (response) => {
        if (response.status === 200) {
          resolve({ text: response.responseText.trim() });
        } else {
          reject(new Error(parseErrorResponse(response.status, response.responseText)));
        }
      },
      onerror: () => {
        reject(new Error("Network error: could not reach Groq API"));
      },
      ontimeout: () => {
        reject(new Error("Request timeout: Groq API did not respond"));
      },
    });
  });
}
