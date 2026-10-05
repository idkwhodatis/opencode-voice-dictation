import { type InputTarget, captureTarget, insertText, isCurrentTarget } from "../src/insert";

interface Boundary { path: number[]; offset: number }
type Position = { kind: "rich"; start: Boundary; end: Boundary } |
  { kind: "textarea"; start: number; end: number };
interface Bookmark {
  target: InputTarget;
  snapshot: string;
  position: Position | null;
  stale: boolean;
}

const snapshot = (target: InputTarget) => target.editor instanceof HTMLTextAreaElement
  ? target.editor.value : target.editor.innerHTML;
const protectedSelector = '[contenteditable="false"], [data-mention], [data-type="mention"], [data-type="attachment"], img';

function boundary(root: Node, node: Node, offset: number): Boundary | null {
  const path: number[] = [];
  while (node !== root) {
    const parent = node.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
    node = parent;
  }
  return { path, offset };
}
function resolve(root: Node, point: Boundary): Node | null {
  let node = root;
  for (const index of point.path) {
    const next = node.childNodes[index];
    if (!next) return null;
    node = next;
  }
  const size = node.nodeType === Node.TEXT_NODE ? node.textContent!.length : node.childNodes.length;
  return point.offset >= 0 && point.offset <= size ? node : null;
}
function selectionPosition(target: InputTarget): Position | null {
  const editor = target.editor;
  // Focus and selection are separate in browsers. Ignore selection collapse caused by
  // clicking a voice button; preserve the last selection deliberately made in the editor.
  if (!editor.contains(document.activeElement)) return null;
  if (editor instanceof HTMLTextAreaElement) {
    return { kind: "textarea", start: editor.selectionStart, end: editor.selectionEnd };
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const start = boundary(editor, range.startContainer, range.startOffset);
  const end = boundary(editor, range.endContainer, range.endOffset);
  return start && end ? { kind: "rich", start, end } : null;
}

// Scoped to the injected edition. The userscript retains its existing append-only behavior.
export function createCaretTracker() {
  const saved = new WeakMap<HTMLElement, Bookmark>();
  function remember() {
    const target = captureTarget("question") ?? captureTarget();
    if (!target) return;
    const position = selectionPosition(target);
    if (position) saved.set(target.editor, { target, snapshot: snapshot(target), position, stale: false });
  }
  // Capture before pointer default actions blur the editor; also cover keyboard-only
  // navigation, textarea selections, typing, and mobile selection handles.
  const events = ["selectionchange", "select", "pointerdown", "pointerup", "keydown", "keyup", "input", "focusin"];
  for (const event of events) document.addEventListener(event, remember, true);
  remember();
  return {
    freeze(target: InputTarget): Bookmark {
      remember();
      const current = snapshot(target);
      const previous = saved.get(target.editor);
      const same = previous?.target.url === target.url && previous.target.composer === target.composer;
      // Store immutable DOM paths, not a live Range that can move during transcription.
      // Identical framework rerenders can recreate nodes without losing the position.
      return {
        target, snapshot: current,
        position: same && previous.snapshot === current ? previous.position : null,
        stale: Boolean(same && previous.snapshot !== current),
      };
    },
    destroy() { for (const event of events) document.removeEventListener(event, remember, true); },
  };
}

const block = /^(DIV|P|LI|PRE|BLOCKQUOTE|H[1-6])$/;
function edgeCharacter(node: Node, before: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const chars = Array.from(node.textContent ?? "");
    return (before ? chars.at(-1) : chars[0]) ?? "";
  }
  if (node instanceof Element && (node.tagName === "BR" || block.test(node.tagName))) return "\n";
  const children = Array.from(node.childNodes);
  if (before) children.reverse();
  for (const child of children) {
    const char = edgeCharacter(child, before);
    if (char) return char;
  }
  return "";
}
function adjacentCharacter(root: Node, node: Node, offset: number, before: boolean): string {
  while (true) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const chars = Array.from(before ? text.slice(0, offset) : text.slice(offset));
      const char = before ? chars.at(-1) : chars[0];
      if (char) return char;
    } else {
      for (let i = before ? offset - 1 : offset; i >= 0 && i < node.childNodes.length; i += before ? -1 : 1) {
        const char = edgeCharacter(node.childNodes[i], before);
        if (char) return char;
      }
    }
    if (node === root || !node.parentNode) return "";
    if (node instanceof Element && block.test(node.tagName)) return "\n";
    const parent = node.parentNode;
    offset = Array.prototype.indexOf.call(parent.childNodes, node) + (before ? 0 : 1);
    node = parent;
  }
}
function spaced(text: string, left: string, right: string): string {
  const word = /[\p{L}\p{N}_]/u;
  const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const needsSpace = (a: string, b: string) => word.test(a) && word.test(b) && !unspaced.test(a + b);
  const chars = Array.from(text);
  return `${needsSpace(left, chars[0] ?? "") ? " " : ""}${text}${needsSpace(chars.at(-1) ?? "", right) ? " " : ""}`;
}
function touchesProtected(editor: HTMLElement, range: Range): boolean {
  for (const node of [range.startContainer, range.endContainer]) {
    const element = node instanceof Element ? node : node.parentElement;
    const protectedNode = element?.closest(protectedSelector);
    if (protectedNode && editor.contains(protectedNode)) return true;
  }
  return !range.collapsed && Array.from(editor.querySelectorAll(protectedSelector)).some((node) => range.intersectsNode(node));
}

export function insertAtCaret(text: string, target: InputTarget, bookmark: Bookmark, edited = false): { inserted: boolean; fallback: boolean } {
  if (!text.trim() || !isCurrentTarget(target) || bookmark.target.editor !== target.editor ||
    bookmark.target.url !== target.url || bookmark.target.composer !== target.composer) return { inserted: false, fallback: false };
  const append = (fallback: boolean) => ({ inserted: insertText(text, target), fallback });
  // Never overwrite edits made while STT was pending, or guess at an invalid selection.
  // Keep the transcript as an appended draft and explicitly suppress direct send instead.
  if (edited || bookmark.stale || snapshot(target) !== bookmark.snapshot) return append(true);
  if (!bookmark.position) return append(false); // No remembered cursor: retain the old default.
  const editor = target.editor;
  const position = bookmark.position;
  if (editor instanceof HTMLTextAreaElement && position.kind === "textarea") {
    if (position.start > position.end || position.end > editor.value.length) return append(true);
    const value = editor.value;
    const addition = spaced(text, Array.from(value.slice(0, position.start)).at(-1) ?? "", Array.from(value.slice(position.end))[0] ?? "");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) return { inserted: false, fallback: false };
    editor.focus();
    if (!isCurrentTarget(target) || snapshot(target) !== bookmark.snapshot) return { inserted: false, fallback: false };
    setter.call(editor, value.slice(0, position.start) + addition + value.slice(position.end));
    editor.setSelectionRange(position.start + addition.length, position.start + addition.length);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: addition }));
    return { inserted: true, fallback: false };
  }
  if (position.kind !== "rich") return append(true);
  const start = resolve(editor, position.start);
  const end = resolve(editor, position.end);
  if (!start || !end) return append(true);
  const range = document.createRange();
  try {
    range.setStart(start, position.start.offset);
    range.setEnd(end, position.end.offset);
  } catch { return append(true); }
  // A selection that contains an atomic mention/attachment is not safe to replace.
  if (touchesProtected(editor, range)) return append(true);
  const addition = spaced(text,
    adjacentCharacter(editor, start, position.start.offset, true),
    adjacentCharacter(editor, end, position.end.offset, false));
  editor.focus();
  if (!isCurrentTarget(target) || snapshot(target) !== bookmark.snapshot) return { inserted: false, fallback: false };
  const selection = window.getSelection();
  if (!selection) return { inserted: false, fallback: false };
  selection.removeAllRanges();
  selection.addRange(range);
  let receivedInput = false;
  let beforeInput: Event | undefined;
  const onInput = () => { receivedInput = true; };
  const onBeforeInput = (event: Event) => { beforeInput = event; };
  editor.addEventListener("input", onInput);
  editor.addEventListener("beforeinput", onBeforeInput);
  try {
    const before = editor.innerHTML;
    let applied = false;
    // Same native insertion mechanism as the shared adapter: preserves undo where
    // supported. Fall back to a text node, never interpolated HTML or editor replacement.
    try { applied = typeof document.execCommand === "function" && document.execCommand("insertText", false, addition); }
    catch { /* Some browsers expose execCommand but reject it. */ }
    if (beforeInput?.defaultPrevented) return { inserted: false, fallback: false };
    if (!applied && !receivedInput && editor.innerHTML === before) {
      range.deleteContents();
      const node = document.createTextNode(addition);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (!receivedInput) editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: addition }));
    return { inserted: true, fallback: false };
  } finally {
    editor.removeEventListener("input", onInput);
    editor.removeEventListener("beforeinput", onBeforeInput);
  }
}
