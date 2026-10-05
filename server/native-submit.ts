import { type InputTarget, type InsertTarget, captureTarget, isCurrentTarget, submitPrompt } from "../src/insert";
import type { DictationState } from "../src/types";

const selector = 'button[data-action="composer-submit"], button[data-action="prompt-submit"]';
const allowedClicks = new WeakSet<HTMLButtonElement>();
const attributes = ["disabled", "aria-disabled", "aria-busy", "title", "aria-label"] as const;
type Attribute = typeof attributes[number];

function nativeButton(target: InputTarget): HTMLButtonElement | null {
  return target.composer.querySelector<HTMLButtonElement>(selector);
}
function isSend(button: HTMLButtonElement): boolean {
  return button.matches('[data-icon="arrow-up"]') || Boolean(
    button.querySelector('svg[data-slot="icon-svg"] use[href="#opencode-v2-icon-arrow-up"]'),
  );
}

// A narrowly scoped, synchronous exception for sendDraft's already-validated click.
// User clicks (including synthetic double clicks) remain blocked during transcription.
export function activateNativeSend(target: InputTarget): boolean {
  const button = nativeButton(target);
  if (!button) return false;
  allowedClicks.add(button);
  try { return submitPrompt(target); }
  finally { allowedClicks.delete(button); }
}

// Borrow attributes, not the node or its event handlers. Remember OpenCode's latest
// values while borrowed so a framework rerender is not undone by a stale snapshot.
function borrow(button: HTMLButtonElement) {
  const original = new Map<Attribute, string | null>(attributes.map((name) => [name, button.getAttribute(name)]));
  let phase: DictationState = "starting";
  let released = false;
  const nativeDisabled = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "disabled")!;
  const previousDisabled = Object.getOwnPropertyDescriptor(button, "disabled");
  const marker = button.getAttribute("data-ocvd-native-phase");
  const hadClass = button.classList.contains("ocvd-send");
  const observer = new MutationObserver((records) => { remember(records); render(); });
  function remember(records: MutationRecord[]) {
    for (const record of records) {
      const name = record.attributeName as Attribute;
      if (original.has(name)) original.set(name, button.getAttribute(name));
    }
  }
  function attribute(name: string, value: string | null) {
    if (button.getAttribute(name) === value) return;
    if (value === null) button.removeAttribute(name);
    else button.setAttribute(name, value);
  }
  function render() {
    if (released) return;
    remember(observer.takeRecords());
    observer.disconnect(); // Our own writes are not OpenCode state changes.
    for (const name of attributes) {
      let value = original.get(name) ?? null;
      if (name === "disabled" && phase === "recording") value = null;
      if (name === "aria-disabled" && phase === "recording") value = "false";
      if (name === "aria-busy") value = phase === "recording" ? value : "true";
      if (name === "title" || name === "aria-label") value = phase === "recording"
        ? "Transcribe and send" : phase === "starting" ? "Waiting for microphone..." : "Transcribing...";
      attribute(name, value);
    }
    attribute("data-ocvd-native-phase", phase);
    // Compatibility selector, now on the ORIGINAL button, never a second button.
    button.classList.toggle("ocvd-send", phase === "recording" || hadClass);
    observer.observe(button, { attributes: true, attributeFilter: [...attributes] });
  }
  // Solid/React write .disabled even if the DOM already has our enabled override.
  // Remember that intent as well: removing an absent attribute yields no reliable
  // mutation record. This accessor exists on this button only, and is removed below.
  const disabledSetter = function (this: HTMLButtonElement, value: boolean) {
    remember(observer.takeRecords());
    original.set("disabled", value ? "" : null);
    render();
  };
  if (!previousDisabled && nativeDisabled.get && nativeDisabled.set) {
    Object.defineProperty(button, "disabled", {
      configurable: true,
      get() { return nativeDisabled.get!.call(this) as boolean; },
      set: disabledSetter,
    });
  }
  return {
    button,
    update(next: DictationState) { phase = next; render(); },
    release() {
      if (released) return;
      remember(observer.takeRecords());
      observer.disconnect();
      released = true;
      if (Object.getOwnPropertyDescriptor(button, "disabled")?.set === disabledSetter) {
        Reflect.deleteProperty(button, "disabled");
      }
      for (const [name, value] of original) attribute(name, value);
      attribute("data-ocvd-native-phase", marker);
      if (!hadClass) button.classList.remove("ocvd-send");
    },
  };
}

export function createNativeSend(onSend: () => void) {
  let state: DictationState = "idle";
  let target: InputTarget | null = null;
  let lease: ReturnType<typeof borrow> | undefined;
  let destroyed = false;
  function sync() {
    const button = !destroyed && state !== "idle" && target?.kind === "composer" && isCurrentTarget(target)
      ? nativeButton(target) : null;
    const eligible = button && isSend(button) && !button.closest("fieldset:disabled") ? button : null;
    if (lease?.button !== eligible) { lease?.release(); lease = undefined; }
    if (eligible) {
      lease ??= borrow(eligible);
      lease.update(state);
    }
  }
  function intercept(event: Event) {
    if (destroyed || state === "idle" || !target || !isCurrentTarget(target)) return;
    const button = nativeButton(target);
    // Never steal Stop/shell or another form's actions, even between observer turns.
    if (!button || !isSend(button) || allowedClicks.has(button)) return;
    const element = event.target instanceof Element ? event.target : null;
    let ours = false;
    if (event.type === "click") ours = element?.closest(selector) === button;
    if (event.type === "submit") {
      const submitter = (event as SubmitEvent).submitter;
      ours = event.target === button.form && (!submitter || submitter === button);
    }
    if (event instanceof KeyboardEvent) {
      // Native button keyboard activation is handled by its resulting click. Enter
      // in the editor can bypass .click(), so catch it before OpenCode's key handler.
      ours = target.editor.contains(element) && event.key === "Enter" && !event.shiftKey &&
        !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && event.keyCode !== 229;
    }
    if (!ours) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state === "recording" && !(event instanceof KeyboardEvent && (event.repeat || event.type === "keyup"))) onSend();
  }
  // Capture beats both direct button listeners and delegated framework handlers.
  const events = ["click", "submit", "keydown", "keyup"];
  for (const event of events) window.addEventListener(event, intercept, true);
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ["data-icon", "href", "data-action", "contenteditable"],
  });
  return {
    update(next: DictationState, kind?: InsertTarget) {
      if (state === "idle" && next !== "idle" && kind === "composer") target = captureTarget(kind);
      state = next;
      if (next === "idle") target = null;
      sync();
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      for (const event of events) window.removeEventListener(event, intercept, true);
      lease?.release(); lease = undefined; target = null;
    },
  };
}
