import { afterEach, describe, expect, it, vi } from "vitest";
import { setupUI } from "../src/ui.js";
import { mountComposer, mountRenamedComposer } from "./fixtures/composer.js";
let ui: ReturnType<typeof setupUI> | undefined;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => {
  ui?.destroy();
  document.body.innerHTML = "";
});
const start = () => {
  ui = setupUI({ onToggle: vi.fn(), onCancel: vi.fn() });
  return ui;
};

describe("mutation-driven UI lifecycle", () => {
  it("waits for the initial lazy composer without polling", async () => {
    document.body.innerHTML = "";
    start();
    expect(document.querySelector(".ocvd-btn")).toBeNull();
    mountComposer();
    await flush();
    expect(document.querySelectorAll('[data-ocvd="controls"]')).toHaveLength(1);
  });
  it("injects once and handles repeated mutations and composer recreation", async () => {
    mountComposer();
    const active = start();
    active.inject();
    active.inject();
    expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
    mountComposer();
    await flush();
    expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
  });
  it("ignores unrelated pages, questions and disabled child-session dock", async () => {
    document.body.innerHTML = '<div data-component="session-prompt-dock">Prompt disabled</div>';
    start();
    expect(document.querySelector(".ocvd-btn")).toBeNull();
    document.body.innerHTML =
      '<div data-component="session-question-dock"><textarea data-slot="question-custom-input"></textarea></div>';
    await flush();
    expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
  });
  it("keeps cancel available while starting and processing", () => {
    mountComposer();
    const active = start();
    for (const state of ["starting", "recording", "processing"] as const) {
      active.updateState(state, 2);
      expect(document.querySelector(".ocvd-cancel.visible")).not.toBeNull();
    }
    active.updateState("idle");
    expect(document.querySelector(".ocvd-cancel.visible")).toBeNull();
  });
  it("removes controls when editor becomes disabled", async () => {
    const editor = mountComposer();
    start();
    editor.contentEditable = "false";
    await flush();
    expect(document.querySelector(".ocvd-btn")).toBeNull();
  });
});

it("mounts one control in renamed beta composer and recreates it on session switch", async () => {
  mountRenamedComposer();
  start();
  expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
  expect(document.querySelector('[data-slot="composer-actions"] > .ocvd-container')).not.toBeNull();
  mountRenamedComposer();
  await flush();
  expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
});

describe.each([mountComposer, mountRenamedComposer])("native action row", (mount) => {
  it("mounts immediately before Submit and settles without an observer loop", async () => {
    mount();
    start();
    const submit = document.querySelector('button[data-action$="-submit"]');
    const controls = document.querySelector(".ocvd-container");
    expect(controls?.nextElementSibling).toBe(submit);
    expect(controls?.parentElement).not.toBe(document.querySelector("form"));
    await flush();
    const changes = vi.fn();
    const observer = new MutationObserver(changes);
    observer.observe(document.body, { childList: true, subtree: true });
    ui?.inject();
    ui?.inject();
    await flush();
    expect(changes).not.toHaveBeenCalled();
    observer.disconnect();
  });

  it("follows replacement, tooltip wrapping and dynamic alternate actions", async () => {
    mount();
    const active = start();
    active.updateState("recording", 3);
    const submit = document.querySelector('button[data-action$="-submit"]') as HTMLButtonElement;
    const controls = document.querySelector(".ocvd-container");
    const replacement = submit.cloneNode(true) as HTMLButtonElement;
    const tooltip = document.createElement("div");
    tooltip.dataset.component = "tooltip-v2-trigger";
    tooltip.append(replacement);
    submit.replaceWith(tooltip);
    const alternate = document.createElement("button");
    alternate.dataset.action = "composer-alternate-delivery";
    tooltip.before(alternate);
    await flush();
    expect(controls?.nextElementSibling).toBe(tooltip);
    expect(controls?.previousElementSibling).toBe(alternate);
    expect(tooltip.querySelector(".ocvd-btn")).toBeNull();
    expect(document.querySelectorAll(".ocvd-btn.recording")).toHaveLength(1);
    expect(document.querySelector(".ocvd-timer")?.textContent).toBe("00:03");
    replacement.replaceWith(replacement.cloneNode(true));
    await flush();
    expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
    const unwrapped = tooltip.querySelector("button") as HTMLButtonElement;
    unwrapped.disabled = true;
    tooltip.replaceWith(unwrapped);
    await flush();
    expect(controls?.nextElementSibling).toBe(unwrapped);
    expect(document.querySelectorAll(".ocvd-btn.recording")).toHaveLength(1);
  });

  it("waits for Submit and recovers after the entire action row is replaced", async () => {
    mount();
    const row = document.querySelector('[data-fixture="toolbar"]') as HTMLElement;
    const newRow = row.cloneNode(true);
    row.remove();
    start();
    expect(document.querySelector(".ocvd-btn")).toBeNull();
    document.querySelector("form")?.append(newRow);
    await flush();
    expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
    newRow.parentNode?.replaceChild(row, newRow);
    await flush();
    expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
    expect(row.querySelector(".ocvd-btn")).not.toBeNull();
  });
});
