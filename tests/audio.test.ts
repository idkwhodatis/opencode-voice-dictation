import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioRecorder, formatTime } from "../src/audio.js";

describe("formatTime", () => {
  it("should format 0 seconds as 00:00", () => {
    expect(formatTime(0)).toBe("00:00");
  });

  it("should format seconds under a minute", () => {
    expect(formatTime(5)).toBe("00:05");
    expect(formatTime(30)).toBe("00:30");
    expect(formatTime(59)).toBe("00:59");
  });

  it("should format exactly one minute", () => {
    expect(formatTime(60)).toBe("01:00");
  });

  it("should format minutes and seconds", () => {
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(125)).toBe("02:05");
    expect(formatTime(599)).toBe("09:59");
    expect(formatTime(600)).toBe("10:00");
  });

  it("should pad single digits with leading zero", () => {
    expect(formatTime(1)).toBe("00:01");
    expect(formatTime(61)).toBe("01:01");
  });
});

const trackStop = vi.fn();
class MockRecorder {
  static supported = "audio/webm;codecs=opus";
  static failConstruct = false;
  static silentStop = false;
  static isTypeSupported(type: string) {
    return type === MockRecorder.supported;
  }
  state = "inactive";
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor(_stream: MediaStream, options: { mimeType: string }) {
    if (MockRecorder.failConstruct) throw new Error("Unsupported recorder");
    this.mimeType = options.mimeType;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    if (MockRecorder.silentStop) return;
    this.ondataavailable?.({ data: new Blob(["synthetic"], { type: this.mimeType }) });
    this.onstop?.();
  }
}
const getUserMedia = vi.fn();
beforeEach(() => {
  trackStop.mockClear();
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
  MockRecorder.failConstruct = false;
  MockRecorder.silentStop = false;
  MockRecorder.supported = "audio/webm;codecs=opus";
  vi.stubGlobal("MediaRecorder", MockRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("microphone cleanup", () => {
  it("stops every track and returns recorder MIME after stop", async () => {
    const recorder = createAudioRecorder();
    await recorder.start();
    expect(recorder.isRecording()).toBe(true);
    const blob = await recorder.stop();
    expect(blob.type).toBe("audio/webm;codecs=opus");
    expect(blob.size).toBeGreaterThan(0);
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(recorder.isRecording()).toBe(false);
  });
  it("releases a late microphone grant after cancellation", async () => {
    let grant: (stream: unknown) => void = () => {};
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const recorder = createAudioRecorder();
    const start = recorder.start();
    recorder.cancel();
    grant({ getTracks: () => [{ stop: trackStop }] });
    await expect(start).rejects.toThrow("cancelled");
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
  it("releases stream if MediaRecorder construction fails", async () => {
    MockRecorder.failConstruct = true;
    await expect(createAudioRecorder().start()).rejects.toThrow("Unsupported");
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
  it("supports MP4 when WebM is unavailable", async () => {
    MockRecorder.supported = "audio/mp4";
    const recorder = createAudioRecorder();
    await recorder.start();
    expect((await recorder.stop()).type).toBe("audio/mp4");
  });
  it("rejects a missing stop callback and still releases tracks", async () => {
    vi.useFakeTimers();
    MockRecorder.silentStop = true;
    const recorder = createAudioRecorder();
    await recorder.start();
    const stop = expect(recorder.stop()).rejects.toThrow("did not finish");
    await vi.advanceTimersByTimeAsync(5000);
    await stop;
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
});
