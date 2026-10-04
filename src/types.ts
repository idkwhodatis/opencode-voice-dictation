export type DictationState = "idle" | "starting" | "recording" | "processing";

export interface AppConfig {
  groqApiKey: string;
  model: string;
  language: string;
  whisperPrompt: string;
  endpoint: string;
  temperature: number;
  autoSubmit: boolean;
}

export interface TranscriptionResult {
  text: string;
}
