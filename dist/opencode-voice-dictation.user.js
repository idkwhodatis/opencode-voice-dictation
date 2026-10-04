// ==UserScript==
// @name         OpenCode Voice Dictation
// @namespace    https://github.com/idkwhodatis/opencode-voice-dictation
// @version      1.1.0
// @author       slaid098
// @description  Voice dictation for OpenCode web using Whisper (Groq API) - works on PC and mobile
// @icon         https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/assets/icon.png
// @downloadURL  https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/dist/opencode-voice-dictation.user.js
// @updateURL    https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/dist/opencode-voice-dictation.meta.js
// @match        https://opencode.invalid/*
// @connect      *
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        window.onurlchange
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  function createAudioRecorder(onError) {
    let mediaRecorder = null;
    let chunks = [];
    let stream = null;
    let cancelled = false;
    let stopping = false;
    let stopPromise = null;
    const release = () => {
      for (const track of (stream == null ? void 0 : stream.getTracks()) ?? []) track.stop();
      stream = null;
    };
    return {
      async start() {
        var _a;
        if (!((_a = navigator.mediaDevices) == null ? void 0 : _a.getUserMedia) || typeof MediaRecorder === "undefined") {
          throw new Error(
            "Microphone recording requires HTTPS (or localhost) and a supported browser."
          );
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          if (cancelled) throw new Error("Recording cancelled");
          const mimeType = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/mp4",
            "audio/ogg;codecs=opus"
          ].find((type) => MediaRecorder.isTypeSupported(type));
          if (!mimeType) throw new Error("No supported audio recording format in this browser.");
          mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: 128e3, mimeType });
          mediaRecorder.ondataavailable = (event) => {
            if (!cancelled && event.data.size > 0) chunks.push(event.data);
          };
          mediaRecorder.onerror = () => {
            release();
            onError == null ? void 0 : onError("Microphone recording failed. Please try again.");
          };
          mediaRecorder.onstop = () => {
            release();
            if (!cancelled && !stopping) onError == null ? void 0 : onError("Microphone recording stopped unexpectedly.");
          };
          mediaRecorder.start();
        } catch (error) {
          release();
          throw error;
        }
      },
      stop() {
        if (stopPromise) return stopPromise;
        const recorder2 = mediaRecorder;
        if (!recorder2 || recorder2.state === "inactive") {
          release();
          return Promise.reject(new Error("No recording in progress."));
        }
        stopping = true;
        stopPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => finish(new Error("Microphone did not finish recording.")),
            5e3
          );
          const finish = (error) => {
            clearTimeout(timeout);
            release();
            const blob = new Blob(chunks, { type: recorder2.mimeType });
            chunks = [];
            if (error) reject(error);
            else resolve(blob);
          };
          recorder2.onstop = () => finish();
          recorder2.onerror = () => finish(new Error("Microphone recording failed."));
          try {
            recorder2.stop();
          } catch {
            finish(new Error("Could not stop recording."));
          }
          release();
        });
        return stopPromise;
      },
      cancel() {
        cancelled = true;
        if ((mediaRecorder == null ? void 0 : mediaRecorder.state) !== "inactive") {
          try {
            mediaRecorder == null ? void 0 : mediaRecorder.stop();
          } catch {
          }
        }
        release();
        chunks = [];
      },
      isRecording: () => (mediaRecorder == null ? void 0 : mediaRecorder.state) === "recording"
    };
  }
  var _GM_getValue = /* @__PURE__ */ (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
  var _GM_registerMenuCommand = /* @__PURE__ */ (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : void 0)();
  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
  var _GM_xmlhttpRequest = /* @__PURE__ */ (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
  const DEFAULTS = {
    groqApiKey: "",
    model: "whisper-large-v3",
    language: "",
    whisperPrompt: "",
    endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    temperature: 0,
    autoSubmit: false
  };
  function getConfig() {
    return {
      groqApiKey: _GM_getValue("groqApiKey", DEFAULTS.groqApiKey),
      model: _GM_getValue("model", DEFAULTS.model),
      language: _GM_getValue("language", DEFAULTS.language),
      whisperPrompt: _GM_getValue("whisperPrompt", DEFAULTS.whisperPrompt),
      endpoint: _GM_getValue("endpoint", DEFAULTS.endpoint),
      temperature: _GM_getValue("temperature", DEFAULTS.temperature),
      autoSubmit: _GM_getValue("autoSubmit", DEFAULTS.autoSubmit)
    };
  }
  function setConfig(partial) {
    for (const [key, value] of Object.entries(partial)) {
      _GM_setValue(key, value);
    }
  }
  function validateApiKey(key) {
    return key.startsWith("gsk_") && key.length > 20;
  }
  function isFirstRun() {
    return _GM_getValue("groqApiKey", "") === "";
  }
  function registerMenuCommands(callbacks) {
    _GM_registerMenuCommand("Set Groq API Key", callbacks.onSetKey);
    _GM_registerMenuCommand("Toggle Auto-Submit", callbacks.onToggleAutoSubmit);
    _GM_registerMenuCommand("Set Whisper Model", callbacks.onSetModel);
    _GM_registerMenuCommand("Set Language", callbacks.onSetLanguage);
    _GM_registerMenuCommand("Set Whisper Prompt", callbacks.onSetPrompt);
    _GM_registerMenuCommand("Set STT Endpoint", callbacks.onSetEndpoint);
    _GM_registerMenuCommand("Set Temperature", callbacks.onSetTemperature);
  }
  const EDITOR_SELECTOR = '[data-component="prompt-input"][contenteditable="true"]';
  const QUESTION_SELECTOR = 'textarea[data-slot="question-custom-input"]:not(:disabled)';
  const COMPOSER_SELECTORS = [
    '[data-component="prompt-input-v2"]',
    '[data-component="session-prompt-dock"]',
    '[data-component="session-new-composer"]',
    '[data-component="session-composer"]'
  ];
  function isQuestionPromptOpen() {
    return document.querySelector(QUESTION_SELECTOR) !== null;
  }
  function captureTarget(kind = "composer") {
    if (kind === "question") {
      const editor = document.querySelector(QUESTION_SELECTOR);
      return (editor == null ? void 0 : editor.parentElement) ? { kind, editor, composer: editor.parentElement, url: location.href } : null;
    }
    if (isQuestionPromptOpen()) return null;
    for (const selector of COMPOSER_SELECTORS) {
      for (const composer of document.querySelectorAll(selector)) {
        if (composer.querySelector('[data-component="session-question-dock"]')) continue;
        const editor = composer.querySelector(EDITOR_SELECTOR);
        if (editor) return { kind, editor, composer, url: location.href };
      }
    }
    return null;
  }
  function isCurrentTarget(target) {
    const current = captureTarget(target.kind);
    return target.url === location.href && (current == null ? void 0 : current.editor) === target.editor && current.composer === target.composer && target.editor.isConnected;
  }
  function insertText(text, target) {
    var _a;
    if (!text.trim() || !isCurrentTarget(target)) return false;
    const { editor } = target;
    const existing = editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent;
    const append = `${existing && !/\s$/.test(existing) ? " " : ""}${text}`;
    editor.focus();
    if (editor instanceof HTMLTextAreaElement) {
      const setter = (_a = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")) == null ? void 0 : _a.set;
      if (!setter) return false;
      setter.call(editor, editor.value + append);
      editor.selectionStart = editor.selectionEnd = editor.value.length;
      editor.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: append })
      );
      return true;
    }
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    let receivedInput = false;
    const onInput = () => {
      receivedInput = true;
    };
    editor.addEventListener("input", onInput);
    try {
      const before = editor.textContent;
      if (typeof document.execCommand === "function") {
        document.execCommand("insertText", false, append);
      }
      if (editor.textContent === before) {
        const node = document.createTextNode(append);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (!receivedInput) {
        editor.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: append })
        );
      }
    } finally {
      editor.removeEventListener("input", onInput);
    }
    return true;
  }
  function submitPrompt(target) {
    if (target.kind !== "composer" || !isCurrentTarget(target)) return false;
    const button = target.composer.querySelector(
      'button[data-action="prompt-submit"]'
    );
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true" || !button.matches('[data-icon="arrow-up"]'))
      return false;
    button.click();
    return true;
  }
  const KEY_ALIASES = {
    space: " ",
    enter: "enter",
    tab: "tab",
    esc: "escape",
    escape: "escape"
  };
  function normalizeKey(key) {
    return KEY_ALIASES[key] ?? key;
  }
  function setupKeyboardShortcut(callback, combo = "ctrl+space") {
    const parts = combo.toLowerCase().split("+");
    const key = normalizeKey(parts[parts.length - 1]);
    const needsCtrl = parts.includes("ctrl");
    const needsShift = parts.includes("shift");
    const handler = (e) => {
      if (!e.repeat && !e.isComposing && !e.altKey && !e.metaKey && e.key.toLowerCase() === key && e.ctrlKey === needsCtrl && e.shiftKey === needsShift) {
        e.preventDefault();
        callback();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }
  function buildFormData(audioBlob, config) {
    const formData = new FormData();
    const extension = audioBlob.type.includes("mp4") ? "mp4" : audioBlob.type.includes("ogg") ? "ogg" : "webm";
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
  function parseErrorResponse(status, _body) {
    if (status === 401) {
      return "Invalid API key. Check your Groq API key in settings.";
    }
    if (status === 429) {
      return "Rate limit exceeded. Please wait and try again.";
    }
    if (status >= 500) {
      return "Groq server error. Please try again later.";
    }
    return `Transcription failed (HTTP ${status}). Check endpoint settings.`;
  }
  function transcribe(audioBlob, config, signal) {
    return new Promise((resolve, reject) => {
      if (!config.groqApiKey) {
        reject(new Error("Groq API key not set. Use the Tampermonkey/Violentmonkey menu to set it."));
        return;
      }
      if (audioBlob.size === 0 || audioBlob.size > 25 * 1024 * 1024) {
        reject(
          new Error(
            audioBlob.size === 0 ? "No audio recorded. Please try again." : "Recording exceeds 25 MB. Record a shorter clip."
          )
        );
        return;
      }
      if (signal == null ? void 0 : signal.aborted) {
        reject(new Error("Transcription cancelled"));
        return;
      }
      let settled = false;
      let request2;
      const finish = (error, text = "") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal == null ? void 0 : signal.removeEventListener("abort", abort);
        if (error) reject(new Error(error));
        else resolve({ text });
      };
      const abort = () => {
        finish("Transcription cancelled");
        request2 == null ? void 0 : request2.abort();
      };
      const timer = setTimeout(() => {
        finish("Request timeout: Groq API did not respond");
        request2 == null ? void 0 : request2.abort();
      }, 6e4);
      signal == null ? void 0 : signal.addEventListener("abort", abort, { once: true });
      try {
        request2 = _GM_xmlhttpRequest({
          method: "POST",
          url: config.endpoint,
          timeout: 6e4,
          headers: { Authorization: `Bearer ${config.groqApiKey}` },
          data: buildFormData(audioBlob, config),
          onload: (response) => {
            if (response.status === 200) finish(void 0, response.responseText.trim());
            else finish(parseErrorResponse(response.status, response.responseText));
          },
          onerror: () => finish("Network error: could not reach Groq API"),
          ontimeout: () => finish("Request timeout: Groq API did not respond"),
          onabort: () => finish("Transcription cancelled")
        });
      } catch {
        finish("Could not start transcription request. Check userscript permissions.");
      }
    });
  }
  const BUTTON_CLASS = "ocvd-btn";
  const CONTAINER_CLASS = "ocvd-container";
  const TIMER_CLASS = "ocvd-timer";
  const CANCEL_CLASS = "ocvd-cancel";
  const ICON_MIC = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
  const ICON_STOP = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>`;
  const ICON_CANCEL = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.3 5.71L12 12l6.3 6.29-1.42 1.42L10.58 13.4 4.29 19.71 2.87 18.3 9.16 12 2.87 5.71 4.29 4.29 10.58 10.58l6.29-6.29z"/></svg>`;
  const ICON_SPINNER = `<svg class="ocvd-spin" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 4V1L16 5l-4 4V6c-3.31 0-6 2.69-6 6 0 1.01.25 1.97.7 2.8L5.24 16.26C4.46 15.03 4 13.57 4 12c0-4.42 3.58-8 8-8z"/></svg>`;
  function createButtonStyle() {
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
  function injectStyles() {
    if (document.getElementById("opencode-voice-dictation-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "opencode-voice-dictation-style";
    style.textContent = createButtonStyle();
    document.head.appendChild(style);
  }
  function showToast(message, isError = false) {
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
    }, 4e3);
  }
  function formatTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  function createContainer() {
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
  function updateAllButtonStates(state, elapsedSeconds2 = 0) {
    const containers = document.querySelectorAll(`.${CONTAINER_CLASS}`);
    for (const container of containers) {
      const button = container.querySelector(`.${BUTTON_CLASS}`);
      const timer = container.querySelector(`.${TIMER_CLASS}`);
      const cancel = container.querySelector(`.${CANCEL_CLASS}`);
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
          timer.textContent = formatTimer(elapsedSeconds2);
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
  function ensureRelative(el) {
    if (window.getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
  }
  function injectIntoElement(parent, onToggle, onCancel, target) {
    const existing = parent.querySelector(`.${CONTAINER_CLASS}`);
    if (existing) {
      return null;
    }
    injectStyles();
    ensureRelative(parent);
    const container = createContainer();
    const button = container.querySelector(`.${BUTTON_CLASS}`);
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onToggle(target);
    });
    const cancel = container.querySelector(`.${CANCEL_CLASS}`);
    cancel.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    });
    parent.appendChild(container);
    return container;
  }
  function setupUI(callbacks) {
    let state = "idle";
    let elapsed = 0;
    let destroyed = false;
    const inject = () => {
      var _a;
      if (destroyed) return;
      (_a = callbacks.onContextChange) == null ? void 0 : _a.call(callbacks);
      const target = captureTarget("question") ?? captureTarget();
      for (const container of document.querySelectorAll(`.${CONTAINER_CLASS}`)) {
        if (container.parentElement !== (target == null ? void 0 : target.composer)) container.remove();
      }
      if (!target) return;
      const added = injectIntoElement(
        target.composer,
        callbacks.onToggle,
        callbacks.onCancel,
        target.kind
      );
      if (added) updateAllButtonStates(state, elapsed);
    };
    const observer = new MutationObserver(inject);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["contenteditable", "disabled"]
    });
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
      }
    };
  }
  const DEFAULTS_ENDPOINT = DEFAULTS.endpoint;
  let recorder = null;
  let currentState = "idle";
  let timerInterval = null;
  let elapsedSeconds = 0;
  let ui = null;
  let currentTarget = null;
  let generation = 0;
  let request = null;
  function setState(state) {
    currentState = state;
    ui == null ? void 0 : ui.updateState(state, elapsedSeconds);
  }
  function reset() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    elapsedSeconds = 0;
    recorder = null;
    currentTarget = null;
    request = null;
    setState("idle");
  }
  function cancelRecording() {
    generation++;
    recorder == null ? void 0 : recorder.cancel();
    request == null ? void 0 : request.abort();
    reset();
  }
  async function toggleDictation(kind) {
    if (currentState === "recording") {
      await stopAndTranscribe();
      return;
    }
    if (currentState !== "idle") return;
    const target = captureTarget(kind);
    if (!target) return;
    if (!getConfig().groqApiKey) {
      ui == null ? void 0 : ui.toast("Set your Groq API key in the Tampermonkey menu first.", true);
      return;
    }
    currentTarget = target;
    const ownGeneration = ++generation;
    const activeRecorder = createAudioRecorder((message) => {
      if (ownGeneration !== generation) return;
      cancelRecording();
      ui == null ? void 0 : ui.toast(message, true);
    });
    recorder = activeRecorder;
    setState("starting");
    try {
      await activeRecorder.start();
      if (ownGeneration !== generation) return;
      if (!isCurrentTarget(target)) {
        cancelRecording();
        return;
      }
      setState("recording");
      timerInterval = setInterval(() => {
        elapsedSeconds++;
        ui == null ? void 0 : ui.updateState(currentState, elapsedSeconds);
      }, 1e3);
    } catch (error) {
      if (ownGeneration !== generation) return;
      activeRecorder.cancel();
      reset();
      ui == null ? void 0 : ui.toast(error instanceof Error ? error.message : "Failed to access microphone", true);
    }
  }
  async function stopAndTranscribe() {
    const activeRecorder = recorder;
    const target = currentTarget;
    if (!activeRecorder || !target || !isCurrentTarget(target)) {
      cancelRecording();
      return;
    }
    const ownGeneration = generation;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    const controller = new AbortController();
    request = controller;
    setState("processing");
    try {
      const audioBlob = await activeRecorder.stop();
      if (ownGeneration !== generation || !isCurrentTarget(target)) return;
      const config = getConfig();
      const result = await transcribe(audioBlob, config, controller.signal);
      if (ownGeneration !== generation || !isCurrentTarget(target)) return;
      if (!result.text) {
        ui == null ? void 0 : ui.toast("No speech detected. Please try again.");
      } else if (!insertText(result.text, target)) {
        ui == null ? void 0 : ui.toast("The original input is no longer available. Dictation discarded.", true);
      } else if (config.autoSubmit && target.kind === "composer") {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        if (ownGeneration === generation && !submitPrompt(target)) {
          ui == null ? void 0 : ui.toast("Text appended. Auto-submit skipped because Send is unavailable.");
        }
      }
    } catch (error) {
      if (ownGeneration === generation && !controller.signal.aborted) {
        ui == null ? void 0 : ui.toast(error instanceof Error ? error.message : "Transcription failed", true);
      }
    } finally {
      if (ownGeneration === generation) reset();
    }
  }
  function promptForApiKey() {
    const key = prompt("Enter your Groq API key (get one free at console.groq.com/keys):", "");
    if (key !== null && (!key.trim() || validateApiKey(key.trim()))) {
      setConfig({ groqApiKey: key.trim() });
      ui == null ? void 0 : ui.toast(key.trim() ? "API key saved!" : "API key cleared");
    } else if (key) {
      ui == null ? void 0 : ui.toast("Invalid key format. Must start with 'gsk_'", true);
    }
  }
  function promptForModel() {
    const model = prompt(
      "Whisper model (whisper-large-v3 or whisper-large-v3-turbo):",
      getConfig().model
    );
    if (model && (model === "whisper-large-v3" || model === "whisper-large-v3-turbo")) {
      setConfig({ model });
      ui == null ? void 0 : ui.toast(`Model set to ${model}`);
    } else if (model) {
      ui == null ? void 0 : ui.toast("Invalid model name", true);
    }
  }
  function promptForLanguage() {
    const lang = prompt(
      "Language code (empty for auto-detect, e.g. 'ru', 'en'):",
      getConfig().language
    );
    if (lang !== null) {
      setConfig({ language: lang.trim() });
      ui == null ? void 0 : ui.toast(lang.trim() ? `Language set to ${lang}` : "Auto-detect enabled");
    }
  }
  function promptForWhisperPrompt() {
    const text = prompt("Whisper prompt (context for transcription):", getConfig().whisperPrompt);
    if (text !== null) {
      setConfig({ whisperPrompt: text });
      ui == null ? void 0 : ui.toast("Whisper prompt updated");
    }
  }
  function promptForEndpoint() {
    const current = getConfig().endpoint;
    const url = prompt("STT endpoint URL:", current);
    if (url === null) {
      return;
    }
    const trimmed = url.trim();
    const value = trimmed || DEFAULTS_ENDPOINT;
    try {
      const endpoint = new URL(value);
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
        throw new Error("Invalid endpoint");
      }
    } catch {
      ui == null ? void 0 : ui.toast("Use an HTTPS endpoint without credentials or a URL fragment.", true);
      return;
    }
    if (value !== current && !confirm(
      `Recordings and your API key will be sent to ${new URL(value).origin}. Only use a proxy you trust. Save endpoint?`
    ))
      return;
    setConfig({ endpoint: value });
    ui == null ? void 0 : ui.toast(`Endpoint set to ${value}`);
  }
  function promptForTemperature() {
    const current = getConfig().temperature;
    const input = prompt("Temperature (0-1):", String(current));
    if (input === null) {
      return;
    }
    const parsed = Number(input);
    if (Number.isNaN(parsed)) {
      ui == null ? void 0 : ui.toast("Invalid temperature", true);
      return;
    }
    const clamped = Math.min(1, Math.max(0, parsed));
    setConfig({ temperature: clamped });
    ui == null ? void 0 : ui.toast(`Temperature set to ${clamped}`);
  }
  function toggleAutoSubmit() {
    const config = getConfig();
    setConfig({ autoSubmit: !config.autoSubmit });
    ui == null ? void 0 : ui.toast(`Auto-submit ${!config.autoSubmit ? "enabled" : "disabled"}`);
  }
  function checkFirstRun() {
    if (isFirstRun()) {
      return setTimeout(() => {
        ui == null ? void 0 : ui.toast("First run: Set your Groq API key via the Violentmonkey/Tampermonkey menu");
      }, 2e3);
    }
  }
  function startApp() {
    const marker = "data-ocvd-initialized";
    if (document.documentElement.hasAttribute(marker)) return () => {
    };
    document.documentElement.setAttribute(marker, "true");
    ui = setupUI({
      onToggle: (target) => {
        void toggleDictation(target);
      },
      onCancel: cancelRecording,
      onContextChange: () => {
        if (currentTarget && !isCurrentTarget(currentTarget)) {
          cancelRecording();
          ui == null ? void 0 : ui.toast("Session or composer changed. Dictation cancelled.");
        }
      }
    });
    const removeShortcut = setupKeyboardShortcut(() => {
      void toggleDictation(isQuestionPromptOpen() ? "question" : "composer");
    });
    window.addEventListener("pagehide", cancelRecording);
    registerMenuCommands({
      onSetKey: promptForApiKey,
      onToggleAutoSubmit: toggleAutoSubmit,
      onSetModel: promptForModel,
      onSetLanguage: promptForLanguage,
      onSetPrompt: promptForWhisperPrompt,
      onSetEndpoint: promptForEndpoint,
      onSetTemperature: promptForTemperature
    });
    const firstRunTimer = checkFirstRun();
    return () => {
      cancelRecording();
      clearTimeout(firstRunTimer);
      removeShortcut();
      window.removeEventListener("pagehide", cancelRecording);
      ui == null ? void 0 : ui.destroy();
      document.documentElement.removeAttribute(marker);
    };
  }
  startApp();

})();