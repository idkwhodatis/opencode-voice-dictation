import { expect, test, type Page } from "@playwright/test";
import type { InputTarget } from "../src/insert";
import type { sendDraft } from "./send";

type Outcome = Awaited<ReturnType<typeof sendDraft>>;
type StateUpdate = "sync" | "microtasks" | "timer";
interface SendFixture {
  target: InputTarget;
  controller: AbortController;
  clicks: string[];
  outcomes: Outcome[];
  start: () => void;
  enable: () => void;
}
declare global { interface Window { sendFixture: SendFixture } }

async function setup(page: Page, stateUpdate: StateUpdate = "sync", disabled = false) {
  // A fixed origin avoids browser/runner wall-clock skew making pauseAt a
  // backwards jump. Only runFor/fastForward advance the send attempt below.
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.goto("/project/session");
  await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
  await page.evaluate(async ({ stateUpdate, disabled }) => {
    const url = "/__test/send.js";
    const { sendDraft } = await import(url) as typeof import("./send");
    const editor = document.querySelector<HTMLElement>('[data-component="composer-editor"]')!;
    const composer = document.querySelector<HTMLElement>('form[data-component="composer"]')!;
    const button = composer.querySelector<HTMLButtonElement>('[data-action="composer-submit"]')!;
    editor.innerHTML = '<span data-mention="true" contenteditable="false">@context</span> old draft <img data-type="attachment" alt="image" src="data:,">';
    let nativeDraft = editor.textContent ?? "";
    const fixture: SendFixture = {
      target: { editor, composer, kind: "composer", url: location.href },
      controller: new AbortController(), clicks: [], outcomes: [],
      start() { void sendDraft(fixture.target, fixture.controller.signal).then((value) => fixture.outcomes.push(value)); },
      enable() { button.disabled = false; button.removeAttribute("aria-disabled"); },
    };
    button.disabled = disabled;
    button.onclick = () => { fixture.clicks.push(nativeDraft); };
    editor.addEventListener("input", () => {
      const next = editor.textContent ?? "";
      const commit = () => { nativeDraft = next; };
      if (stateUpdate === "sync") commit();
      // One await Promise.resolve() is insufficient: the second microtask would
      // still see old reactive state when the button was already enabled.
      else if (stateUpdate === "microtasks") queueMicrotask(() => queueMicrotask(commit));
      else setTimeout(commit, 0);
    });
    const text = document.createTextNode(" new transcript");
    editor.append(text);
    const range = document.createRange(); range.setStart(text, text.length); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text.textContent }));
    window.sendFixture = fixture;
    fixture.start();
  }, { stateUpdate, disabled });
}

async function result(page: Page) {
  return page.evaluate(() => ({ outcomes: window.sendFixture.outcomes, clicks: window.sendFixture.clicks }));
}

for (const update of ["sync", "microtasks", "timer"] as const) {
  test(`first ready attempt has no 50 ms delay and uses the new ${update} state`, async ({ page }) => {
    await setup(page, update);
    expect(await result(page)).toEqual({ outcomes: [], clicks: [] });
    await page.clock.runFor(1);
    expect(await result(page)).toEqual({ outcomes: ["sent"], clicks: ["@context old draft  new transcript"] });
    expect(await page.locator("[data-mention]").count()).toBe(1);
    expect(await page.locator('[data-type="attachment"]').count()).toBe(1);
    expect(await page.evaluate(() => window.getSelection()!.anchorOffset)).toBe(" new transcript".length);
    // Dispatch is the end of our job, even if the host neither clears the draft
    // nor acknowledges a network submission. It must never cause a second click.
    await page.clock.runFor(2000);
    expect((await result(page)).clicks).toHaveLength(1);
  });
}

for (const block of ["disabled", "aria-disabled", "fieldset"]) {
  test(`retries only after native ${block} readiness, then dispatches once`, async ({ page }) => {
    await setup(page, "sync", true);
    await page.evaluate((block) => {
      const { composer } = window.sendFixture.target;
      const button = composer.querySelector<HTMLButtonElement>('[data-action="composer-submit"]')!;
      if (block === "aria-disabled") { button.disabled = false; button.setAttribute("aria-disabled", "true"); }
      if (block === "fieldset") {
        button.disabled = false;
        const fieldset = document.createElement("fieldset"); fieldset.disabled = true;
        button.replaceWith(fieldset); fieldset.append(button);
      }
    }, block);
    await page.clock.runFor(200);
    expect((await result(page)).clicks).toHaveLength(0);
    await page.evaluate(() => {
      window.sendFixture.enable();
      const fieldset = document.querySelector("fieldset"); if (fieldset) fieldset.disabled = false;
    });
    await page.clock.runFor(50);
    expect((await result(page)).outcomes).toEqual(["sent"]);
    await page.clock.runFor(2000);
    expect((await result(page)).clicks).toHaveLength(1);
  });
}

for (const interruption of ["abort", "input", "attachment", "navigate", "replace", "question", "native-click"] as const) {
  test(`${interruption} cancels a readiness retry without a later automatic send`, async ({ page }) => {
    await setup(page, "sync", true);
    await page.clock.runFor(1);
    await page.evaluate((interruption) => {
      const fixture = window.sendFixture;
      const { editor, composer } = fixture.target;
      if (interruption === "abort") fixture.controller.abort();
      if (interruption === "input") editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
      // Rich attachment changes can preserve textContent. They still change the draft.
      if (interruption === "attachment") editor.querySelector("img")!.setAttribute("alt", "different image");
      if (interruption === "navigate") history.pushState({}, "", "/project/other-session");
      if (interruption === "replace") editor.replaceWith(editor.cloneNode(true));
      if (interruption === "question") {
        const question = document.createElement("textarea"); question.dataset.slot = "question-custom-input";
        document.body.append(question);
      }
      fixture.enable();
      if (interruption === "native-click") composer.querySelector<HTMLButtonElement>('[data-action="composer-submit"]')!.click();
    }, interruption);
    await page.clock.runFor(2000);
    const changed = ["input", "attachment", "native-click"].includes(interruption);
    expect((await result(page)).outcomes).toEqual([changed ? "changed" : "cancelled"]);
    expect((await result(page)).clicks).toHaveLength(interruption === "native-click" ? 1 : 0);
  });
}

test("abort before the first attempt cancels immediately", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.sendFixture.controller.abort());
  expect((await result(page)).outcomes).toEqual(["cancelled"]);
  await page.clock.runFor(2000);
  expect((await result(page)).clicks).toHaveLength(0);
});

test("concurrent sends share the native-click guard and cannot double dispatch", async ({ page }) => {
  await setup(page, "sync", true);
  await page.evaluate(() => window.sendFixture.start());
  await page.clock.runFor(1);
  await page.evaluate(() => window.sendFixture.enable());
  await page.clock.runFor(100);
  expect((await result(page)).outcomes.sort()).toEqual(["changed", "sent"]);
  expect((await result(page)).clicks).toHaveLength(1);
});

for (const action of ["stop", "terminal", "missing", "hidden"]) {
  test(`${action} appearing during retry ends the attempt without clicking`, async ({ page }) => {
    await setup(page, "sync", true);
    await page.clock.runFor(1);
    await page.evaluate((action) => {
      const button = document.querySelector<HTMLButtonElement>('[data-action="composer-submit"]')!;
      window.sendFixture.enable();
      if (action === "missing") button.remove();
      else if (action === "hidden") button.style.display = "none";
      else button.dataset.icon = action;
    }, action);
    await page.clock.runFor(2000);
    expect(await result(page)).toEqual({ outcomes: ["unavailable"], clicks: [] });
  });
}

test("readiness exhaustion ends at 1.5 s with the draft retained", async ({ page }) => {
  await setup(page, "sync", true);
  await page.clock.runFor(1499);
  expect((await result(page)).outcomes).toEqual([]);
  await page.clock.runFor(1);
  expect(await result(page)).toEqual({ outcomes: ["unavailable"], clicks: [] });
  await page.evaluate(() => window.sendFixture.enable());
  await page.clock.runFor(1000);
  expect((await result(page)).clicks).toHaveLength(0);
  await expect(page.locator('[data-component="composer-editor"]')).toContainText("new transcript");
});

test("a throttled retry cannot click after the deadline", async ({ page }) => {
  await setup(page, "sync", true);
  await page.clock.runFor(1);
  await page.evaluate(() => window.sendFixture.enable());
  await page.clock.fastForward(2000);
  expect(await result(page)).toEqual({ outcomes: ["unavailable"], clicks: [] });
});
