import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupUI } from "../src/ui.js";

const COMPOSER_BTN_SELECTOR = ".ocvd-btn";

function setupCallbacks() {
  return {
    onToggle: vi.fn(),
    onCancel: vi.fn(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("setupUI composer injection", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("should inject mic button when prompt-input-v2 is present", () => {
    document.body.innerHTML =
      '<div data-component="session-prompt-dock"><div data-component="prompt-input-v2"></div></div>';

    setupUI(setupCallbacks());

    const btn = document.querySelector(COMPOSER_BTN_SELECTOR);
    expect(btn).not.toBeNull();
  });

  it("should inject mic button when prompt-input is present inside dock", () => {
    document.body.innerHTML =
      '<div data-component="session-prompt-dock"><div data-component="prompt-input" contenteditable="true"></div></div>';

    setupUI(setupCallbacks());

    const btn = document.querySelector(COMPOSER_BTN_SELECTOR);
    expect(btn).not.toBeNull();
  });

  it("should NOT inject mic button when dock has no prompt-input (child session disabled block)", () => {
    document.body.innerHTML =
      '<div data-component="session-prompt-dock"><div>Prompt is disabled</div><button type="button">Back to parent</button></div>';

    setupUI(setupCallbacks());

    const btn = document.querySelector(COMPOSER_BTN_SELECTOR);
    expect(btn).toBeNull();
  });

  it("should NOT inject mic button when only session-prompt-dock exists without any composer inside", () => {
    document.body.innerHTML = '<div data-component="session-prompt-dock"></div>';

    setupUI(setupCallbacks());

    const btn = document.querySelector(COMPOSER_BTN_SELECTOR);
    expect(btn).toBeNull();
  });

  it("should NOT inject composer mic button when question-custom-input is open (PR #31 regression guard)", () => {
    document.body.innerHTML =
      '<div data-component="session-prompt-dock"><div data-component="session-question-dock"><textarea data-slot="question-custom-input"></textarea></div></div>';

    setupUI(setupCallbacks());

    const dock = document.querySelector('[data-component="session-prompt-dock"]');
    const composerContainer = dock?.querySelector(":scope > .ocvd-container");
    expect(composerContainer).toBeNull();
  });
});
