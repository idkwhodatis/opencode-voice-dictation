// Verified against anomalyco/opencode 907b3bc (see ADR 0008).
// V2's form is prompt-input-v2; its editable child is still prompt-input.
const EDITOR_SELECTOR = '[data-component="prompt-input"][contenteditable="true"]';
const QUESTION_SELECTOR = 'textarea[data-slot="question-custom-input"]:not(:disabled)';
const COMPOSER_SELECTORS = [
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
    'button[data-action="prompt-submit"]',
  );
  // OpenCode reuses this button for Stop and shell execution. Only click Send.
  if (
    !button ||
    button.disabled ||
    button.getAttribute("aria-disabled") === "true" ||
    !button.matches('[data-icon="arrow-up"]')
  )
    return false;
  button.click();
  return true;
}
