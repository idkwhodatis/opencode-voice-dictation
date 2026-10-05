import { type InputTarget, isCurrentTarget } from "../src/insert";
import { activateNativeSend } from "./native-submit";

export function draftSnapshot(target: InputTarget): string {
  return target.editor instanceof HTMLTextAreaElement ? target.editor.value : target.editor.innerHTML;
}

// Wait briefly for OpenCode to consume the input event and enable its own Send button.
// Never force-enable message submission or queue a send behind a running agent.
export async function sendDraft(target: InputTarget, signal: AbortSignal): Promise<"sent" | "cancelled" | "changed" | "unavailable"> {
  const text = target.editor.textContent;
  let edited = false;
  const changed = () => { edited = true; };
  const nativeClick = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('button[data-action="composer-submit"], button[data-action="prompt-submit"]')) edited = true;
  };
  target.editor.addEventListener("input", changed);
  target.composer.addEventListener("click", nativeClick, true);
  const deadline = performance.now() + 1500;
  try {
    do {
      // Allow reactive state/DOM updates to settle; a single synchronous click is too early.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      if (signal.aborted || !isCurrentTarget(target)) return "cancelled";
      if (edited || target.editor.textContent !== text) return "changed";
      const button = target.composer.querySelector<HTMLButtonElement>(
        'button[data-action="composer-submit"], button[data-action="prompt-submit"]',
      );
      const isSend = button?.matches('[data-icon="arrow-up"]') ||
        button?.querySelector('svg[data-slot="icon-svg"] use[href="#opencode-v2-icon-arrow-up"]');
      // Unknown/shell/Stop actions are not a reason to keep retrying.
      if (!button || !isSend || !button.getClientRects().length) return "unavailable";
      if (!button.matches(":disabled") && activateNativeSend(target)) return "sent";
    } while (performance.now() < deadline);
    return "unavailable";
  } finally {
    target.editor.removeEventListener("input", changed);
    target.composer.removeEventListener("click", nativeClick, true);
  }
}
