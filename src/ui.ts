import { type InsertTarget, captureTarget } from "./insert.js";
import type { DictationState } from "./types.js";

const BUTTON_CLASS = "ocvd-btn";
const CONTAINER_CLASS = "ocvd-container";
const TIMER_CLASS = "ocvd-timer";
const CANCEL_CLASS = "ocvd-cancel";
const ICON_MIC = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>`;
const ICON_CANCEL = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.3 5.71L12 12l6.3 6.29-1.42 1.42L10.58 13.4 4.29 19.71 2.87 18.3 9.16 12 2.87 5.71 4.29 4.29 10.58 10.58l6.29-6.29z"/></svg>`;
const ICON_SPINNER = `<svg class="ocvd-spin" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 4V1L16 5l-4 4V6c-3.31 0-6 2.69-6 6 0 1.01.25 1.97.7 2.8L5.24 16.26C4.46 15.03 4 13.57 4 12c0-4.42 3.58-8 8-8z"/></svg>`;

function createButtonStyle(): string {
  return `
    .${CONTAINER_CLASS} {
      position: absolute !important;
      top: 8px;
      right: 8px;
      z-index: 999998;
      display: flex;
      align-items: center;
      gap: 6px;
      pointer-events: none;
    }
    .${CONTAINER_CLASS} > * {
      pointer-events: auto;
    }
    .${BUTTON_CLASS} {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: var(--color-bg-tertiary, rgba(128, 128, 128, 0.15));
      color: var(--color-text-secondary, #888);
      cursor: pointer;
      transition: all 0.2s ease;
      padding: 0;
      flex-shrink: 0;
    }
    .${BUTTON_CLASS}:hover {
      background: var(--color-bg-hover, rgba(128, 128, 128, 0.25));
      color: var(--color-text-primary, #fff);
    }
    .${BUTTON_CLASS}.recording {
      background: #e53935;
      color: #fff;
      animation: ocvd-pulse 1.5s ease-in-out infinite;
    }
    .${BUTTON_CLASS}.processing {
      background: var(--color-accent, #4a9eff);
      color: #fff;
      pointer-events: none;
      opacity: 0.8;
    }
    .${CANCEL_CLASS} {
      display: none;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: rgba(128, 128, 128, 0.5);
      color: #fff;
      cursor: pointer;
      transition: all 0.2s ease;
      padding: 0;
      flex-shrink: 0;
    }
    .${CANCEL_CLASS}:hover {
      background: rgba(128, 128, 128, 0.7);
      color: #fff;
    }
    .${CANCEL_CLASS}.visible {
      display: flex;
    }
    .${TIMER_CLASS} {
      display: none;
      font-family: monospace;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      background: #e53935;
      padding: 4px 10px;
      border-radius: 12px;
      align-items: center;
      gap: 5px;
      line-height: 1;
      white-space: nowrap;
    }
    .${TIMER_CLASS}.visible {
      display: inline-flex;
    }
    .${TIMER_CLASS}::before {
      content: "";
      width: 7px;
      height: 7px;
      background: #fff;
      border-radius: 50%;
      animation: ocvd-blink 1s ease-in-out infinite;
      flex-shrink: 0;
    }
    @keyframes ocvd-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.4); }
      50% { box-shadow: 0 0 0 6px rgba(229, 57, 53, 0); }
    }
    @keyframes ocvd-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    @keyframes ocvd-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .ocvd-spin {
      animation: ocvd-spin 0.8s linear infinite;
      transform-origin: center;
    }
    #opencode-voice-toast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #1a1a1a;
      color: #fff;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-family: -apple-system, sans-serif;
      z-index: 999999;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
      max-width: 90vw;
      text-align: center;
    }
    #opencode-voice-toast.visible {
      opacity: 1;
    }
    #opencode-voice-toast.error {
      background: #e53935;
    }
  `;
}

function injectStyles(): void {
  if (document.getElementById("opencode-voice-dictation-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "opencode-voice-dictation-style";
  style.textContent = createButtonStyle();
  document.head.appendChild(style);
}

function showToast(message: string, isError = false): void {
  let toast = document.getElementById("opencode-voice-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "opencode-voice-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = isError ? "visible error" : "visible";
  setTimeout(() => {
    toast.className = "";
  }, 4000);
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function createContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.className = CONTAINER_CLASS;
  container.dataset.ocvd = "controls";

  const cancel = document.createElement("button");
  cancel.className = CANCEL_CLASS;
  cancel.type = "button";
  cancel.title = "Cancel dictation";
  cancel.setAttribute("aria-label", "Cancel dictation");
  cancel.innerHTML = ICON_CANCEL;

  const timer = document.createElement("span");
  timer.className = TIMER_CLASS;
  timer.textContent = "00:00";

  const button = document.createElement("button");
  button.className = BUTTON_CLASS;
  button.type = "button";
  button.title = "Voice Dictation (Ctrl+Space)";
  button.innerHTML = ICON_MIC;

  container.appendChild(cancel);
  container.appendChild(timer);
  container.appendChild(button);

  return container;
}

function updateAllButtonStates(state: DictationState, elapsedSeconds = 0): void {
  const containers = document.querySelectorAll<HTMLElement>(`.${CONTAINER_CLASS}`);

  for (const container of containers) {
    const button = container.querySelector<HTMLElement>(`.${BUTTON_CLASS}`);
    const timer = container.querySelector<HTMLElement>(`.${TIMER_CLASS}`);
    const cancel = container.querySelector<HTMLElement>(`.${CANCEL_CLASS}`);

    if (!button || !timer || !cancel) continue;

    button.classList.remove("recording", "processing");
    timer.classList.remove("visible");
    cancel.classList.remove("visible");

    switch (state) {
      case "idle":
        button.innerHTML = ICON_MIC;
        button.title = "Voice Dictation (Ctrl+Space)";
        break;
      case "recording":
        button.classList.add("recording");
        button.innerHTML = ICON_STOP;
        button.title = "Stop recording";
        timer.textContent = formatTimer(elapsedSeconds);
        timer.classList.add("visible");
        cancel.classList.add("visible");
        break;
      case "starting":
      case "processing":
        button.classList.add("processing");
        button.innerHTML = ICON_SPINNER;
        button.title = state === "starting" ? "Waiting for microphone..." : "Transcribing...";
        cancel.classList.add("visible");
        break;
    }
    button.setAttribute("aria-label", button.title);
  }
}

function ensureRelative(el: HTMLElement): void {
  if (window.getComputedStyle(el).position === "static") {
    el.style.position = "relative";
  }
}

function injectIntoElement(
  parent: HTMLElement,
  onToggle: (target: InsertTarget) => void,
  onCancel: () => void,
  target: InsertTarget,
): HTMLElement | null {
  const existing = parent.querySelector(`.${CONTAINER_CLASS}`);
  if (existing) {
    return null;
  }

  injectStyles();
  ensureRelative(parent);

  const container = createContainer();

  const button = container.querySelector(`.${BUTTON_CLASS}`) as HTMLButtonElement;
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle(target);
  });

  const cancel = container.querySelector(`.${CANCEL_CLASS}`) as HTMLButtonElement;
  cancel.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  });

  parent.appendChild(container);
  return container;
}

export function setupUI(callbacks: {
  onToggle: (target: InsertTarget) => void;
  onCancel: () => void;
  onContextChange?: () => void;
}): {
  inject: () => void;
  updateState: (state: DictationState, elapsedSeconds?: number) => void;
  toast: (message: string, isError?: boolean) => void;
  destroy: () => void;
} {
  let state: DictationState = "idle";
  let elapsed = 0;
  let destroyed = false;
  const inject = () => {
    if (destroyed) return;
    callbacks.onContextChange?.();
    const target = captureTarget("question") ?? captureTarget();
    for (const container of document.querySelectorAll(`.${CONTAINER_CLASS}`)) {
      if (container.parentElement !== target?.composer) container.remove();
    }
    if (!target) return;
    const added = injectIntoElement(
      target.composer,
      callbacks.onToggle,
      callbacks.onCancel,
      target.kind,
    );
    if (added) updateAllButtonStates(state, elapsed);
  };
  const observer = new MutationObserver(inject);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["contenteditable", "disabled"],
  });
  // Tampermonkey observes pushState/replaceState without page-world monkeypatching.
  window.addEventListener("urlchange", inject);
  window.addEventListener("popstate", inject);
  window.addEventListener("hashchange", inject);
  inject();
  return {
    inject,
    updateState: (next, seconds = 0) => {
      state = next;
      elapsed = seconds;
      updateAllButtonStates(state, elapsed);
    },
    toast: showToast,
    destroy: () => {
      destroyed = true;
      observer.disconnect();
      window.removeEventListener("urlchange", inject);
      window.removeEventListener("popstate", inject);
      window.removeEventListener("hashchange", inject);
      for (const container of document.querySelectorAll(`.${CONTAINER_CLASS}`)) container.remove();
    },
  };
}
