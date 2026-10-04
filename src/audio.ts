export interface AudioRecorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
  cancel(): void;
  isRecording(): boolean;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function createAudioRecorder(onError?: (message: string) => void): AudioRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let cancelled = false;
  let stopping = false;
  let stopPromise: Promise<Blob> | null = null;
  const release = () => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  };
  return {
    async start() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error(
          "Microphone recording requires HTTPS (or localhost) and a supported browser.",
        );
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) throw new Error("Recording cancelled");
        const mimeType = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/mp4",
          "audio/ogg;codecs=opus",
        ].find((type) => MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw new Error("No supported audio recording format in this browser.");
        mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: 128000, mimeType });
        mediaRecorder.ondataavailable = (event) => {
          if (!cancelled && event.data.size > 0) chunks.push(event.data);
        };
        mediaRecorder.onerror = () => {
          release();
          onError?.("Microphone recording failed. Please try again.");
        };
        mediaRecorder.onstop = () => {
          release();
          if (!cancelled && !stopping) onError?.("Microphone recording stopped unexpectedly.");
        };
        mediaRecorder.start();
      } catch (error) {
        release();
        throw error;
      }
    },
    stop() {
      if (stopPromise) return stopPromise;
      const recorder = mediaRecorder;
      if (!recorder || recorder.state === "inactive") {
        release();
        return Promise.reject(new Error("No recording in progress."));
      }
      stopping = true;
      stopPromise = new Promise<Blob>((resolve, reject) => {
        const timeout = setTimeout(
          () => finish(new Error("Microphone did not finish recording.")),
          5000,
        );
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          release();
          const blob = new Blob(chunks, { type: recorder.mimeType });
          chunks = [];
          if (error) reject(error);
          else resolve(blob);
        };
        recorder.onstop = () => finish();
        recorder.onerror = () => finish(new Error("Microphone recording failed."));
        try {
          recorder.stop();
        } catch {
          finish(new Error("Could not stop recording."));
        }
        release();
      });
      return stopPromise;
    },
    cancel() {
      cancelled = true;
      if (mediaRecorder?.state !== "inactive") {
        try {
          mediaRecorder?.stop();
        } catch {
          /* Already stopped. */
        }
      }
      release();
      chunks = [];
    },
    isRecording: () => mediaRecorder?.state === "recording",
  };
}
