const KEY_ALIASES: Record<string, string> = {
  space: " ",
  enter: "enter",
  tab: "tab",
  esc: "escape",
  escape: "escape",
};

function normalizeKey(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

export function setupKeyboardShortcut(callback: () => void, combo = "ctrl+space"): () => void {
  const parts = combo.toLowerCase().split("+");
  const key = normalizeKey(parts[parts.length - 1]);
  const needsCtrl = parts.includes("ctrl");
  const needsShift = parts.includes("shift");

  const handler = (e: KeyboardEvent) => {
    if (
      !e.repeat &&
      !e.isComposing &&
      !e.altKey &&
      !e.metaKey &&
      e.key.toLowerCase() === key &&
      e.ctrlKey === needsCtrl &&
      e.shiftKey === needsShift
    ) {
      e.preventDefault();
      callback();
    }
  };

  document.addEventListener("keydown", handler);

  return () => {
    document.removeEventListener("keydown", handler);
  };
}
