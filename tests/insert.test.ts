import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureTarget, insertText, isCurrentTarget, submitPrompt } from "../src/insert.js";
import { mountComposer, mountRenamedComposer } from "./fixtures/composer.js";

function target(kind: "composer" | "question" = "composer") {
  const result = captureTarget(kind);
  if (!result) throw new Error("Missing fixture target");
  return result;
}

beforeEach(() => {
  document.execCommand = vi.fn(() => false);
  mountComposer();
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("source-verified composer adapter", () => {
  it("selects the editable child, never the V2 form", () => {
    expect(captureTarget()?.editor.getAttribute("data-component")).toBe("prompt-input");
    expect(captureTarget()?.composer.tagName).toBe("FORM");
  });
  it.each(["session-composer", "session-new-composer"])("retains cheap %s fallback", (wrapper) => {
    mountComposer(wrapper);
    expect(captureTarget()).not.toBeNull();
  });
  it("rejects unrelated, empty or disabled composers", () => {
    document.body.innerHTML =
      '<div contenteditable="true"></div><form data-component="prompt-input-v2"></form>';
    expect(captureTarget()).toBeNull();
    mountComposer().contentEditable = "false";
    expect(captureTarget()).toBeNull();
  });
  it("appends text and notifies framework state without replacing mentions or attachments", () => {
    const editor = mountComposer();
    editor.innerHTML =
      'Review <span contenteditable="false" data-mention="file" data-path="src/a.ts">@a.ts</span>';
    const mention = editor.firstElementChild;
    const attachments = document.querySelector('[data-slot="prompt-attachments"]');
    let value = "";
    editor.addEventListener("input", () => {
      value = editor.textContent ?? "";
    });
    expect(insertText("then add tests", target())).toBe(true);
    expect(value).toBe("Review @a.ts then add tests");
    expect(editor.firstElementChild).toBe(mention);
    expect(document.querySelector('[data-slot="prompt-attachments"]')).toBe(attachments);
    expect(document.execCommand).toHaveBeenCalledWith("insertText", false, " then add tests");
  });
  it("does not duplicate native input events or insertions", () => {
    const editor = mountComposer();
    const onInput = vi.fn();
    editor.addEventListener("input", onInput);
    document.execCommand = vi.fn((_command, _show, text) => {
      editor.append(text ?? "");
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    });
    insertText("hello", target());
    expect(editor.textContent).toBe("hello");
    expect(onInput).toHaveBeenCalledTimes(1);
  });
  it("rejects stale route and recreated editor targets", () => {
    const snapshot = target();
    history.pushState({}, "", "/other-session");
    expect(isCurrentTarget(snapshot)).toBe(false);
    expect(insertText("wrong session", snapshot)).toBe(false);
    const second = target();
    mountComposer();
    expect(insertText("wrong editor", second)).toBe(false);
  });
  it("clicks only the current enabled Send button, never Stop or shell", () => {
    const snapshot = target();
    const button = snapshot.composer.querySelector("button") as HTMLButtonElement;
    const click = vi.fn();
    button.addEventListener("click", click);
    expect(submitPrompt(snapshot)).toBe(true);
    button.disabled = true;
    expect(submitPrompt(snapshot)).toBe(false);
    button.disabled = false;
    for (const icon of ["stop", "arrow-undo-down"]) {
      button.dataset.icon = icon;
      expect(submitPrompt(snapshot)).toBe(false);
    }
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("appends question input through its native setter and event", () => {
    document.body.innerHTML =
      '<div><textarea data-slot="question-custom-input">Existing</textarea></div>';
    const snapshot = target("question");
    const textarea = snapshot.editor as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 8);
    const input = vi.fn();
    textarea.addEventListener("input", input);
    expect(insertText("answer", snapshot)).toBe(true);
    expect(textarea.value).toBe("Existing answer");
    expect(input).toHaveBeenCalledTimes(1);
    expect(submitPrompt(snapshot)).toBe(false);
    expect(captureTarget()).toBeNull();
  });
});

describe("renamed beta composer regression", () => {
  it("finds the actual composer-editor and appends without replacing rich nodes", () => {
    const editor = mountRenamedComposer();
    editor.innerHTML =
      'Review <span contenteditable="false" data-mention="file" data-path="fixture.ts">@fixture.ts</span>';
    const mention = editor.firstElementChild;
    const attachments = document.querySelector('[data-slot="composer-attachments"]');
    const snapshot = target();
    expect(snapshot.editor).toBe(editor);
    expect(snapshot.composer.getAttribute("data-component")).toBe("composer");
    const onInput = vi.fn();
    editor.addEventListener("input", onInput);
    expect(insertText("add tests", snapshot)).toBe(true);
    expect(editor.textContent).toBe("Review @fixture.ts add tests");
    expect(editor.firstElementChild).toBe(mention);
    expect(document.querySelector('[data-slot="composer-attachments"]')).toBe(attachments);
    expect(onInput).toHaveBeenCalledOnce();
  });
  it("uses the beta SVG sprite to distinguish Send from Stop and shell", () => {
    mountRenamedComposer();
    const snapshot = target();
    const button = snapshot.composer.querySelector("button") as HTMLButtonElement;
    const icon = button.querySelector("use") as SVGUseElement;
    const click = vi.fn();
    button.addEventListener("click", click);
    expect(submitPrompt(snapshot)).toBe(true);
    button.disabled = true;
    expect(submitPrompt(snapshot)).toBe(false);
    button.disabled = false;
    for (const name of ["stop", "arrow-undo-down", "unknown"]) {
      icon.setAttribute("href", `#opencode-v2-icon-${name}`);
      expect(submitPrompt(snapshot)).toBe(false);
    }
    expect(click).toHaveBeenCalledOnce();
  });
  it("rejects stale or disabled beta editors", () => {
    const editor = mountRenamedComposer();
    const snapshot = target();
    editor.contentEditable = "false";
    expect(captureTarget()).toBeNull();
    mountRenamedComposer();
    expect(insertText("wrong editor", snapshot)).toBe(false);
  });
});
