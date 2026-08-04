import { describe, expect, it, vi } from "vitest";

vi.mock("$", () => ({
  GM_xmlhttpRequest: vi.fn(),
}));

import { GM_xmlhttpRequest } from "$";
import { buildFormData, parseErrorResponse, transcribe } from "../src/transcribe.js";
import type { AppConfig } from "../src/types.js";

const mockConfig: AppConfig = {
  groqApiKey: "gsk_test_key_1234567890",
  model: "whisper-large-v3",
  language: "ru",
  whisperPrompt: "Software development discussion.",
  endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
  temperature: 0,
  autoSubmit: false,
};

const mockConfigAuto: AppConfig = {
  ...mockConfig,
  language: "",
  whisperPrompt: "",
};

describe("buildFormData", () => {
  it("should include file, model, and response_format", () => {
    const blob = new Blob(["audio data"], { type: "audio/webm" });
    const formData = buildFormData(blob, mockConfig);

    expect(formData.get("model")).toBe("whisper-large-v3");
    expect(formData.get("response_format")).toBe("text");
    expect(formData.get("language")).toBe("ru");
    expect(formData.get("prompt")).toBe("Software development discussion.");
    expect(formData.get("temperature")).toBe("0");

    const file = formData.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
  });

  it("should omit language and prompt when empty", () => {
    const blob = new Blob(["audio data"], { type: "audio/webm" });
    const formData = buildFormData(blob, mockConfigAuto);

    expect(formData.get("model")).toBe("whisper-large-v3");
    expect(formData.get("response_format")).toBe("text");
    expect(formData.get("language")).toBeNull();
    expect(formData.get("prompt")).toBeNull();
    expect(formData.get("temperature")).toBe("0");
  });

  it("should send temperature as string", () => {
    const blob = new Blob(["audio data"], { type: "audio/webm" });
    const config = { ...mockConfig, temperature: 0.5 };
    const formData = buildFormData(blob, config);

    expect(formData.get("temperature")).toBe("0.5");
  });
});

describe("parseErrorResponse", () => {
  it("should return invalid API key message for 401", () => {
    const result = parseErrorResponse(401, '{"error":{"message":"Unauthorized"}}');
    expect(result).toBe("Invalid API key. Check your Groq API key in settings.");
  });

  it("should return rate limit message for 429", () => {
    const result = parseErrorResponse(429, "");
    expect(result).toBe("Rate limit exceeded. Please wait and try again.");
  });

  it("should return server error message for 500+", () => {
    const result = parseErrorResponse(500, "");
    expect(result).toBe("Groq server error. Please try again later.");
  });

  it("should parse JSON error body for unknown status codes", () => {
    const result = parseErrorResponse(400, '{"error":{"message":"Bad request"}}');
    expect(result).toBe("Bad request");
  });

  it("should return raw body on JSON parse failure", () => {
    const result = parseErrorResponse(400, "Plain text error");
    expect(result).toBe("Error 400: Plain text error");
  });
});

describe("transcribe", () => {
  it("should reject when API key is not set", async () => {
    const blob = new Blob(["audio"], { type: "audio/webm" });
    const config = { ...mockConfig, groqApiKey: "" };
    await expect(transcribe(blob, config)).rejects.toThrow("Groq API key not set");
  });

  it("should reject when audio blob is empty", async () => {
    const blob = new Blob([], { type: "audio/webm" });
    await expect(transcribe(blob, mockConfig)).rejects.toThrow("No audio recorded");
  });

  it("should resolve with transcribed text on success", async () => {
    const blob = new Blob(["audio"], { type: "audio/webm" });
    vi.mocked(GM_xmlhttpRequest).mockClear();

    const promise = transcribe(blob, mockConfig);

    const callArgs = vi.mocked(GM_xmlhttpRequest).mock.calls[0][0] as unknown as {
      onload: (response: { status: number; responseText: string }) => void;
    };
    callArgs.onload({ status: 200, responseText: "hello world" });

    const result = await promise;
    expect(result.text).toBe("hello world");
  });

  it("should reject on API error", async () => {
    const blob = new Blob(["audio"], { type: "audio/webm" });
    vi.mocked(GM_xmlhttpRequest).mockClear();

    const promise = transcribe(blob, mockConfig);

    const callArgs = vi.mocked(GM_xmlhttpRequest).mock.calls[0][0] as unknown as {
      onload: (response: { status: number; responseText: string }) => void;
    };
    callArgs.onload({
      status: 401,
      responseText: '{"error":{"message":"Unauthorized"}}',
    });

    await expect(promise).rejects.toThrow("Invalid API key");
  });

  it("should reject on network error", async () => {
    const blob = new Blob(["audio"], { type: "audio/webm" });
    vi.mocked(GM_xmlhttpRequest).mockClear();

    const promise = transcribe(blob, mockConfig);

    const callArgs = vi.mocked(GM_xmlhttpRequest).mock.calls[0][0] as unknown as {
      onerror: (error: unknown) => void;
    };
    callArgs.onerror(new Error("network"));

    await expect(promise).rejects.toThrow("Network error");
  });

  it("should reject on timeout", async () => {
    const blob = new Blob(["audio"], { type: "audio/webm" });
    vi.mocked(GM_xmlhttpRequest).mockClear();

    const promise = transcribe(blob, mockConfig);

    const callArgs = vi.mocked(GM_xmlhttpRequest).mock.calls[0][0] as unknown as {
      ontimeout: () => void;
    };
    callArgs.ontimeout();

    await expect(promise).rejects.toThrow("Request timeout");
  });
});
