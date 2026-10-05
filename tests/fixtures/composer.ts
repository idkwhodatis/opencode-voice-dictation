// Shape verified from OpenCode 907b3bc, session-ui/v2/components/prompt-input/index.tsx.
export function mountComposer(wrapper = "prompt-input-v2"): HTMLDivElement {
  document.body.innerHTML = `<div data-component="session-prompt-dock">
    <form data-component="${wrapper}">
      <div data-slot="prompt-attachments"><span>image.png</span></div>
      <div data-component="prompt-input" contenteditable="true" role="textbox"></div>
      <button type="button" data-action="prompt-submit" data-icon="arrow-up"></button>
    </form></div>`;
  return document.querySelector('[data-component="prompt-input"]') as HTMLDivElement;
}

// Sanitized structure observed in a saved user page; confirmed in OpenCode beta e5ecb571.
// Only public UI markers are retained. No original page text, URLs, or scripts.
export function mountRenamedComposer(): HTMLDivElement {
  document.body.innerHTML = `<div data-component="session-composer-dock">
    <form data-component="composer">
      <div data-slot="composer-attachments"><span>fixture.png</span></div>
      <div data-component="composer-scroll"><div role="region">
        <div data-component="composer-editor" contenteditable="true" role="textbox"></div>
      </div></div>
      <button type="button" data-action="composer-submit" data-component="icon-button-v2">
        <svg data-slot="icon-svg"><use href="#opencode-v2-icon-arrow-up"></use></svg>
      </button>
    </form></div>`;
  return document.querySelector('[data-component="composer-editor"]') as HTMLDivElement;
}
