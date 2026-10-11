import { type InputTarget, isCurrentTarget } from "../src/insert";
import { activateNativeSend } from "./native-submit";

export function draftSnapshot(target: InputTarget): string {
  return target.editor instanceof HTMLTextAreaElement ? target.editor.value : target.editor.innerHTML;
}

function waitForTurn(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}

// Retry native readiness, never a dispatched click or an unacknowledged network send.
// Never force-enable message submission or queue a send behind a running agent.
export async function sendDraft(target: InputTarget, signal: AbortSignal): Promise<"sent" | "cancelled" | "changed" | "unavailable"> {
  const draft = draftSnapshot(target);
  let edited = false;
  const changed = () => { edited = true; };
  const nativeClick = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('button[data-action="composer-submit"], button[data-action="prompt-submit"]')) edited = true;
  };
  target.editor.addEventListener("input", changed);
  target.composer.addEventListener("click", nativeClick, true);
  const deadline = performance.now() + 1500;
  try {
    // OpenCode consumes input synchronously. Yield one event-loop turn as well so
    // queued reactive microtasks (including nested ones) finish before submission.
    // An already-enabled button alone cannot prove it holds the newly inserted draft.
    await waitForTurn(0, signal);
    while (true) {
      if (signal.aborted || !isCurrentTarget(target)) return "cancelled";
      if (edited || draftSnapshot(target) !== draft) return "changed";
      // Background tabs may resume timers late. Never click beyond the retry budget.
      if (performance.now() >= deadline) return "unavailable";
      const button = target.composer.querySelector<HTMLButtonElement>(
        'button[data-action="composer-submit"], button[data-action="prompt-submit"]',
      );
      const isSend = button?.matches('[data-icon="arrow-up"]') ||
        button?.querySelector('svg[data-slot="icon-svg"] use[href="#opencode-v2-icon-arrow-up"]');
      // Unknown/shell/Stop actions are not a reason to keep retrying.
      if (!button || !isSend || !button.getClientRects().length) return "unavailable";
      if (!button.matches(":disabled") && activateNativeSend(target)) return "sent";
      await waitForTurn(Math.min(50, Math.max(0, deadline - performance.now())), signal);
    }
  } finally {
    target.editor.removeEventListener("input", changed);
    target.composer.removeEventListener("click", nativeClick, true);
  }
}
