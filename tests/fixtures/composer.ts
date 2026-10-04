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
