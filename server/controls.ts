import type { InsertTarget } from "../src/insert";
import type { DictationState } from "../src/types";
import { createNativeSend } from "./native-submit";

// Server-only controls: leave the userscript's shared UI and distribution unchanged.
export function createServerControls(onSend: () => void) {
  let state: DictationState = "idle";
  const native = createNativeSend(onSend);
  const style = document.createElement("style");
  style.textContent = `
    [data-ocvd-native-phase="recording"] { cursor: pointer; }
    [data-ocvd-native-phase="starting"], [data-ocvd-native-phase="processing"] {
      cursor: progress; opacity: 0.65;
    }
    .ocvd-settings[hidden] { display: none; }
    .ocvd-settings { display: inline-flex; align-items: center; justify-content: center;
      min-width: 28px; min-height: 28px; color: inherit; text-decoration: none; }
  `;
  document.head.appendChild(style);

  function sync() {
    for (const controls of document.querySelectorAll<HTMLElement>(".ocvd-container")) {
      let link = controls.querySelector<HTMLAnchorElement>(".ocvd-settings");
      if (!link) {
        link = document.createElement("a");
        link.className = "ocvd-settings";
        link.href = "/voice/";
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "⚙";
        link.title = "Voice settings (server)";
        link.setAttribute("aria-label", link.title);
        controls.prepend(link);
      }
      const hideSettings = state !== "idle";
      if (link.hidden !== hideSettings) link.hidden = hideSettings;
      const stop = controls.querySelector<HTMLButtonElement>(".ocvd-btn");
      if (!stop) continue;
      const disabled = state === "starting" || state === "processing";
      if (stop.disabled !== disabled) stop.disabled = disabled;
      if (state === "recording") {
        if (stop.title !== "Stop and review") stop.title = "Stop and review";
        if (stop.getAttribute("aria-label") !== stop.title) stop.setAttribute("aria-label", stop.title);
      }
    }
  }
  // Every mutation is conditional so this observer cannot trigger a render loop.
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  sync();
  return {
    update(next: DictationState, kind?: InsertTarget) { state = next; native.update(next, kind); sync(); },
    destroy() { observer.disconnect(); native.destroy(); style.remove(); },
  };
}
