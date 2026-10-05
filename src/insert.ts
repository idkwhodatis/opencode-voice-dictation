// Verified against dev 907b3bc and beta e5ecb571 (ADRs 0008 and 0009).
// The beta composer renamed both its form and editor; stable V2 retains prompt-input.
const EDITOR_SELECTOR =
  '[data-component="composer-editor"][contenteditable="true"], [data-component="prompt-input"][contenteditable="true"]';
const QUESTION_SELECTOR = 'textarea[data-slot="question-custom-input"]:not(:disabled)';
const COMPOSER_SELECTORS = [
  'form[data-component="composer"]',
  '[data-component="prompt-input-v2"]',
  '[data-component="session-prompt-dock"]',
  '[data-component="session-new-composer"]',
  '[data-component="session-composer"]',
];

export type InsertTarget = "composer" | "question";
export interface InputTarget {
  kind: InsertTarget;
  editor: HTMLElement | HTMLTextAreaElement;
  composer: HTMLElement;
  url: string;
}

export function isQuestionPromptOpen(): boolean {
  return document.querySelector(QUESTION_SELECTOR) !== null;
}

export function captureTarget(kind: InsertTarget = "composer"): InputTarget | null {
  if (kind === "question") {
    const editor = document.querySelector<HTMLTextAreaElement>(QUESTION_SELECTOR);
    return editor?.parentElement
      ? { kind, editor, composer: editor.parentElement, url: location.href }
      : null;
  }
  if (isQuestionPromptOpen()) return null;
  for (const selector of COMPOSER_SELECTORS) {
    for (const composer of document.querySelectorAll<HTMLElement>(selector)) {
      if (composer.querySelector('[data-component="session-question-dock"]')) continue;
      const editor = composer.querySelector<HTMLElement>(EDITOR_SELECTOR);
      if (editor) return { kind, editor, composer, url: location.href };
    }
  }
  return null;
}

export function isCurrentTarget(target: InputTarget): boolean {
  const current = captureTarget(target.kind);
  return (
    target.url === location.href &&
    current?.editor === target.editor &&
    current.composer === target.composer &&
    target.editor.isConnected
  );
}

export function insertText(text: string, target: InputTarget): boolean {
  if (!text.trim() || !isCurrentTarget(target)) return false;
  const { editor } = target;
  const existing = editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent;
  const append = `${existing && !/\s$/.test(existing) ? " " : ""}${text}`;
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    // Use the native setter and input event, so framework state sees the append.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(editor, editor.value + append);
    editor.selectionStart = editor.selectionEnd = editor.value.length;
    editor.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: append }),
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
  // Same insertion path as OpenCode V2's paste handler. Never replace innerHTML
  // or textContent: mentions and attachments must remain intact.
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
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: append }),
      );
    }
  } finally {
    editor.removeEventListener("input", onInput);
  }
  return true;
}

export function submitPrompt(target: InputTarget): boolean {
  if (target.kind !== "composer" || !isCurrentTarget(target)) return false;
  const button = target.composer.querySelector<HTMLButtonElement>(
    'button[data-action="composer-submit"], button[data-action="prompt-submit"]',
  );
  // Both layouts reuse their submit button for Stop and shell execution. The
  // beta IconButton uses a sprite instead of data-icon; do not guess from labels.
  const isSend =
    button?.matches('[data-icon="arrow-up"]') ||
    button?.querySelector('svg[data-slot="icon-svg"] use[href="#opencode-v2-icon-arrow-up"]');
  // Click only a verified Send icon in the original composer.
  if (!button || button.disabled || button.getAttribute("aria-disabled") === "true" || !isSend)
    return false;
  button.click();
  return true;
}
