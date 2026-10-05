import type { InsertTarget } from "../src/insert";
import type { DictationState } from "../src/types";

// Server-only controls: leave the userscript's shared UI and distribution unchanged.
export function createServerControls(onSend: () => void) {
  let state: DictationState = "idle";
  let target: InsertTarget | undefined;
  const style = document.createElement("style");
  style.textContent = `
    .ocvd-send {
      box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
      width: var(--ocvd-button-width, 28px); height: var(--ocvd-button-height, 28px);
      padding: var(--ocvd-button-padding, 6px); border-radius: var(--ocvd-button-radius, 6px);
      border: none; flex-shrink: 0; cursor: pointer;
      background: var(--color-accent, #4a9eff); color: #fff;
    }
    .ocvd-send[hidden] { display: none; }
    .ocvd-send:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    .ocvd-send > svg { width: var(--ocvd-icon-width, 16px); height: var(--ocvd-icon-height, 16px); }
    .ocvd-settings { display: inline-flex; align-items: center; justify-content: center;
      min-width: 28px; min-height: 28px; color: inherit; text-decoration: none; }
  `;
  document.head.appendChild(style);

  function sync() {
    for (const controls of document.querySelectorAll<HTMLElement>(".ocvd-container")) {
      if (!controls.querySelector(".ocvd-settings")) {
        const link = document.createElement("a");
        link.className = "ocvd-settings";
        link.href = "/voice/";
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "⚙";
        link.title = "Voice settings (server)";
        link.setAttribute("aria-label", link.title);
        controls.prepend(link);
      }
      const stop = controls.querySelector<HTMLButtonElement>(".ocvd-btn");
      if (!stop) continue;
      const disabled = state === "starting" || state === "processing";
      if (stop.disabled !== disabled) stop.disabled = disabled;
      if (state === "recording") {
        if (stop.title !== "Stop and review") stop.title = "Stop and review";
        if (stop.getAttribute("aria-label") !== stop.title) stop.setAttribute("aria-label", stop.title);
      }
      if (controls.dataset.target !== "composer") continue;
      let send = controls.querySelector<HTMLButtonElement>(".ocvd-send");
      if (!send) {
        send = document.createElement("button");
        send.className = "ocvd-send";
        send.type = "button";
        send.title = "Transcribe and send";
        send.setAttribute("aria-label", send.title);
        send.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7"/></svg>';
        send.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (state === "recording" && target === "composer") onSend();
        });
        // Keep the original mic/stop last: shared native-spacing measurement relies on it.
        controls.insertBefore(send, stop);
      }
      const enabled = state === "recording" && target === "composer";
      if (send.hidden === enabled) send.hidden = !enabled;
      if (send.disabled === enabled) send.disabled = !enabled;
    }
  }
  // Reapply labels after shared timer rendering and attach controls to lazy/replaced composers.
  // Every mutation is conditional so this observer cannot trigger an endless render loop.
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  sync();
  return {
    update(next: DictationState, kind?: InsertTarget) { state = next; target = kind; sync(); },
    destroy() { observer.disconnect(); style.remove(); },
  };
}
