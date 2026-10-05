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
  expect(
    document.querySelector('form[data-component="composer"] > .ocvd-container'),
  ).not.toBeNull();
  mountRenamedComposer();
  await flush();
  expect(document.querySelectorAll(".ocvd-btn")).toHaveLength(1);
});
