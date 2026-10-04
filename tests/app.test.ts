import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountComposer } from "./fixtures/composer.js";

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  xhr: vi.fn(),
  menu: vi.fn(),
}));
vi.mock("$", () => ({
  GM_getValue: (key: string, fallback: unknown) => mocks.store[key] ?? fallback,
  GM_setValue: (key: string, value: unknown) => {
    mocks.store[key] = value;
  },
  GM_registerMenuCommand: mocks.menu,
  GM_xmlhttpRequest: mocks.xhr,
}));
vi.mock("../src/audio.js", () => ({
  createAudioRecorder: () => ({
    start: mocks.start,
    stop: mocks.stop,
    cancel: mocks.cancel,
    isRecording: () => true,
  }),
}));
let dispose: () => void;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = () => (document.querySelector(".ocvd-btn") as HTMLButtonElement).click();
const cancel = () => (document.querySelector(".ocvd-cancel") as HTMLButtonElement).click();
const response = (status = 200, text = "dictated words") =>
  mocks.xhr.mock.calls.at(-1)?.[0].onload({ status, responseText: text });
const idle = () => expect(document.querySelector(".ocvd-btn")?.className).toBe("ocvd-btn");

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.store)) delete mocks.store[key];
  mocks.store.groqApiKey = "TEST_ONLY_NOT_A_REAL_KEY";
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(new Blob(["synthetic fixture"], { type: "audio/webm" }));
  mocks.xhr.mockReturnValue({ abort: vi.fn() });
  mountComposer();
  document.execCommand = vi.fn(() => false);
  dispose = (await import("../src/app.js")).startApp();
});
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("dictation flow with mocked microphone and Groq", () => {
  it("records, stops, appends through input, and leaves auto-submit OFF by default", async () => {
    const editor = document.querySelector('[data-component="prompt-input"]') as HTMLElement;
    editor.textContent = "Existing";
    let frameworkValue = "";
    editor.addEventListener("input", () => {
      frameworkValue = editor.textContent ?? "";
    });
    const send = vi.fn();
    document.querySelector('[data-action="prompt-submit"]')?.addEventListener("click", send);
    click();
    await flush();
    expect(mocks.start).toHaveBeenCalledTimes(1);
    click();
    await flush();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.xhr).toHaveBeenCalledTimes(1);
    response();
    await flush();
    expect(frameworkValue).toBe("Existing dictated words");
    expect(send).not.toHaveBeenCalled();
    idle();
  });
  it("auto-submits only after framework input updates the original Send button", async () => {
    mocks.store.autoSubmit = true;
    const send = vi.fn();
    document.querySelector('[data-action="prompt-submit"]')?.addEventListener("click", send);
    click();
    await flush();
    click();
    await flush();
    response();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    idle();
  });
  it("does not start twice while microphone permission is pending, and can cancel", async () => {
    let allow: () => void = () => {};
    mocks.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          allow = resolve;
        }),
    );
    click();
    click();
    expect(mocks.start).toHaveBeenCalledTimes(1);
    cancel();
    allow();
    await flush();
    idle();
    expect(mocks.xhr).not.toHaveBeenCalled();
  });
  it("recovers from microphone denial and supports retry", async () => {
    mocks.start.mockRejectedValueOnce(new Error("Microphone permission denied"));
    click();
    await flush();
    idle();
    expect(document.querySelector("#opencode-voice-toast")?.textContent).toContain("denied");
    click();
    await flush();
    expect(document.querySelector(".ocvd-btn.recording")).not.toBeNull();
  });
  it("cancels recording without sending audio", async () => {
    click();
    await flush();
    cancel();
    await flush();
    expect(mocks.cancel).toHaveBeenCalled();
    expect(mocks.xhr).not.toHaveBeenCalled();
    idle();
  });
  it("aborts a pending request and ignores its late result", async () => {
    click();
    await flush();
    click();
    await flush();
    cancel();
    response();
    await flush();
    expect(mocks.xhr.mock.results[0].value.abort).toHaveBeenCalled();
    expect(document.querySelector('[data-component="prompt-input"]')?.textContent).toBe("");
    idle();
  });
  it.each([401, 429, 500])("clears loading state after HTTP %s", async (status) => {
    click();
    await flush();
    click();
    await flush();
    response(status, "error");
    await flush();
    idle();
    expect(document.querySelector("#opencode-voice-toast.error")).not.toBeNull();
  });
  it("clears state on recorder stop failure and empty transcript", async () => {
    mocks.stop.mockRejectedValueOnce(new Error("Recorder failed"));
    click();
    await flush();
    click();
    await flush();
    idle();
    click();
    await flush();
    click();
    await flush();
    response(200, "  ");
    await flush();
    idle();
    expect(document.querySelector("#opencode-voice-toast")?.textContent).toContain("No speech");
  });
  it("cancels on route changes, even when the same editor remains mounted", async () => {
    mocks.store.autoSubmit = true;
    click();
    await flush();
    click();
    await flush();
    history.pushState({}, "", "/project/session/another");
    window.dispatchEvent(new Event("urlchange"));
    response();
    await flush();
    idle();
    expect(document.querySelector('[data-component="prompt-input"]')?.textContent).toBe("");
  });
  it("cancels on composer replacement and reinjects one working control", async () => {
    click();
    await flush();
    mountComposer();
    await flush();
    idle();
    expect(mocks.cancel).toHaveBeenCalled();
    expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
    click();
    await flush();
    expect(document.querySelector(".ocvd-btn.recording")).not.toBeNull();
  });
  it("cancels on pagehide/refresh and prevents duplicate initialization", async () => {
    (await import("../src/app.js")).startApp();
    expect(mocks.menu).toHaveBeenCalledTimes(7);
    click();
    await flush();
    window.dispatchEvent(new Event("pagehide"));
    idle();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
  it("does not request mic or API on unrelated pages or when key is missing", async () => {
    document.body.innerHTML = "<textarea></textarea>";
    await flush();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true }));
    expect(mocks.start).not.toHaveBeenCalled();
    mountComposer();
    await flush();
    mocks.store.groqApiKey = "";
    click();
    await flush();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.xhr).not.toHaveBeenCalled();
  });
});
