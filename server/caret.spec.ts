import { expect, test, type Page } from "@playwright/test";

const editorSelector = '[data-component="composer-editor"], [data-component="prompt-input"][contenteditable]';
const idleName = "Voice Dictation (Ctrl+Space)";
const draft = "Please fix before committing.";
const expected = "Please fix the login bug before committing.";

test.beforeEach(async ({ page, request }) => {
  await request.post("/__test/reset");
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start();
      await context.resume();
      return destination.stream;
    } });
  });
  await transcript(page, "the login bug");
});

async function transcript(page: Page, text: string, delay = 0) {
  await page.unroute("**/voice/transcribe");
  await page.route("**/voice/transcribe", async (route) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ text }) });
  });
}
async function open(page: Page, text = draft) {
  await page.goto("/project/session");
  await expect(page.getByRole("button", { name: idleName, exact: true })).toBeVisible();
  await page.locator(editorSelector).fill(text);
}
async function select(page: Page, start: number, end = start, backward = false) {
  await page.locator(editorSelector).evaluate((editor, { start, end, backward }) => {
    (editor as HTMLElement).focus();
    const node = editor.firstChild!;
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(node, backward ? end : start, node, backward ? start : end);
  }, { start, end, backward });
}
async function record(page: Page) {
  await page.getByRole("button", { name: idleName, exact: true }).tap();
  await expect(page.getByRole("button", { name: "Stop and review", exact: true })).toBeVisible();
  await page.waitForTimeout(150);
}
async function finish(page: Page, action = "Stop and review") {
  await page.getByRole("button", { name: action, exact: true }).tap();
  await expect(page.getByRole("button", { name: idleName, exact: true })).toBeEnabled();
}

for (const dialect of ["beta", "stable"]) {
  for (const action of ["Stop and review", "Transcribe and send"]) {
    test(`${action} inserts in the middle of the native ${dialect} composer`, async ({ page }) => {
      await open(page);
      if (dialect === "stable") {
        await page.evaluate(() => {
          document.querySelector("form")!.dataset.component = "prompt-input-v2";
          document.querySelector<HTMLElement>('[data-component="composer-editor"]')!.dataset.component = "prompt-input";
          document.querySelector<HTMLElement>('[data-action="composer-submit"]')!.dataset.action = "prompt-submit";
        });
      }
      await select(page, 11);
      await record(page);
      await finish(page, action);
      await expect(page.locator(editorSelector)).toHaveText(expected);
      expect(await page.evaluate("window.sendCount")).toBe(action === "Transcribe and send" ? 1 : 0);
    });
  }
}

for (const offset of [0, draft.length]) {
  test(`inserts at ${offset === 0 ? "start" : "end"} with word spacing`, async ({ page }) => {
    await transcript(page, "patch");
    await open(page);
    await select(page, offset);
    await record(page);
    await finish(page);
    await expect(page.locator(editorSelector)).toHaveText(offset === 0 ? `patch ${draft}` : `${draft} patch`);
  });
}

test("uses the latest cursor deliberately moved while recording", async ({ page }) => {
  await open(page);
  await select(page, 0);
  await record(page);
  await select(page, 11);
  await finish(page, "Transcribe and send");
  await expect(page.locator(editorSelector)).toHaveText(expected);
  expect(await page.evaluate("window.sendCount")).toBe(1);
});

test("freezes insertion at Stop/Send even if the cursor moves during transcription", async ({ page }) => {
  await transcript(page, "the login bug", 600);
  await open(page);
  await select(page, 11);
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
  await select(page, 0);
  await expect(page.getByRole("button", { name: idleName, exact: true })).toBeEnabled();
  await expect(page.locator(editorSelector)).toHaveText(expected);
  expect(await page.evaluate("window.sendCount")).toBe(1);
});

test("remembers selection when focusing voice controls removes the browser selection", async ({ page }) => {
  await open(page);
  await select(page, 11);
  await record(page);
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>(".ocvd-send")!.focus();
    window.getSelection()!.removeAllRanges();
  });
  await finish(page, "Transcribe and send");
  await expect(page.locator(editorSelector)).toHaveText(expected);
});

test("Ctrl+Space uses the current cursor and always leaves a draft", async ({ page }) => {
  await open(page);
  await select(page, 11);
  await page.keyboard.press("Control+Space");
  await expect(page.getByRole("button", { name: "Stop and review", exact: true })).toBeVisible();
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+Space");
  await expect(page.getByRole("button", { name: idleName, exact: true })).toBeEnabled();
  await expect(page.locator(editorSelector)).toHaveText(expected);
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

for (const backward of [false, true]) {
  test(`replaces only selected plain text (${backward ? "backward" : "forward"} selection)`, async ({ page }) => {
    await open(page, "Please fix WRONG before committing.");
    await select(page, 11, 16, backward);
    await record(page);
    await finish(page);
    await expect(page.locator(editorSelector)).toHaveText(expected);
    expect(await page.evaluate("window.sendCount")).toBe(0);
  });
}

test("replacing a selection with identical text does not duplicate it", async ({ page }) => {
  await transcript(page, "patch");
  await open(page, "before patch after");
  await select(page, 7, 12);
  await record(page);
  await finish(page, "Transcribe and send");
  await expect(page.locator(editorSelector)).toHaveText("before patch after");
  expect(await page.evaluate("window.sendCount")).toBe(1);
});

test("Range fallback works without execCommand and treats transcript as plain text", async ({ page }) => {
  await transcript(page, "<img onerror=bad()>");
  await open(page, "before WRONG after");
  await select(page, 7, 12);
  await page.evaluate(() => { document.execCommand = () => false; });
  await record(page);
  await finish(page);
  await expect(page.locator(editorSelector)).toHaveText("before <img onerror=bad()> after");
  await expect(page.locator(`${editorSelector.split(",")[0]} img`)).toHaveCount(0);
});

test("Chinese insertion does not introduce spaces between Chinese characters", async ({ page }) => {
  await transcript(page, "登录问题");
  await open(page, "请修复后再提交");
  await select(page, 3);
  await record(page);
  await finish(page);
  await expect(page.locator(editorSelector)).toHaveText("请修复登录问题后再提交");
});

test("preserves punctuation and Unicode surrounding the insertion", async ({ page }) => {
  await transcript(page, "patch");
  await open(page, "😀 Fix , please.");
  await select(page, 7);
  await record(page);
  await finish(page);
  await expect(page.locator(editorSelector)).toHaveText("😀 Fix patch, please.");
});

test("multiline rich text keeps line structure and unrelated formatting", async ({ page }) => {
  await transcript(page, "patch");
  await open(page);
  await page.locator(editorSelector).evaluate((editor) => {
    editor.innerHTML = "<div><b>First line</b></div><div>Second line</div>";
    (editor as HTMLElement).focus();
    const node = editor.lastChild!.firstChild!;
    window.getSelection()!.setBaseAndExtent(node, 0, node, 0);
  });
  await record(page);
  await finish(page);
  await expect(page.locator(`${editorSelector.split(",")[0]} > div`)).toHaveCount(2);
  await expect(page.locator(`${editorSelector.split(",")[0]} > div`).nth(1)).toHaveText("patch Second line");
  await expect(page.locator(`${editorSelector.split(",")[0]} b`)).toHaveText("First line");
});

test("insertion beside a mention preserves the actual mention and attachment nodes", async ({ page }) => {
  await transcript(page, "patch");
  await page.goto("/project/session");
  await page.locator(editorSelector).evaluate((editor) => {
    editor.innerHTML = '<span contenteditable="false" data-mention="true">@context</span> before after';
    const attachment = document.createElement("div");
    attachment.dataset.attachment = "true";
    attachment.textContent = "attached.txt";
    editor.parentElement!.appendChild(attachment);
    Object.assign(window, { originalMention: editor.firstChild, originalAttachment: attachment });
    (editor as HTMLElement).focus();
    const node = editor.lastChild!;
    window.getSelection()!.setBaseAndExtent(node, 8, node, 8);
  });
  await record(page);
  await finish(page, "Transcribe and send");
  await expect(page.locator(editorSelector)).toHaveText("@context before patch after");
  expect(await page.evaluate("window.originalMention === document.querySelector('[data-mention]')")).toBe(true);
  expect(await page.evaluate("window.originalAttachment === document.querySelector('[data-attachment]')")).toBe(true);
  expect(await page.evaluate("window.sendCount")).toBe(1);
});

test("a selection containing a mention is not deleted and never auto-sent", async ({ page }) => {
  await transcript(page, "patch");
  await page.goto("/project/session");
  await page.locator(editorSelector).evaluate((editor) => {
    (editor as HTMLElement).focus();
    const range = document.createRange(); range.selectNodeContents(editor);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await record(page);
  await finish(page, "Transcribe and send");
  await expect(page.locator(editorSelector)).toHaveText("@context existing patch");
  await expect(page.locator("[data-mention]")).toHaveCount(1);
  expect(await page.evaluate("window.sendCount")).toBe(0);
  await expect(page.locator("#opencode-voice-toast")).toContainText("saved cursor unavailable");
});

test("identical editor-node rerenders during STT do not relocate the frozen cursor", async ({ page }) => {
  await transcript(page, "the login bug", 600);
  await open(page);
  await select(page, 11);
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
  await page.locator(editorSelector).evaluate((editor) => { editor.innerHTML = editor.innerHTML; });
  await expect(page.getByRole("button", { name: idleName, exact: true })).toBeEnabled();
  await expect(page.locator(editorSelector)).toHaveText(expected);
  expect(await page.evaluate("window.sendCount")).toBe(1);
});

test("edits after Stop invalidate replacement and keep both draft and transcript for review", async ({ page }) => {
  await transcript(page, "patch", 600);
  await open(page, "before WRONG after");
  await select(page, 7, 12);
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
  await page.locator(editorSelector).fill("Updated by user");
  await expect(page.getByRole("button", { name: idleName, exact: true })).toBeEnabled();
  await expect(page.locator(editorSelector)).toHaveText("Updated by user patch");
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

test("a stale selection before Stop appends for review instead of guessing", async ({ page }) => {
  await transcript(page, "patch");
  await open(page);
  await select(page, 11);
  await record(page);
  await page.locator(editorSelector).evaluate((editor) => { editor.textContent = "Programmatic draft"; });
  await finish(page, "Transcribe and send");
  await expect(page.locator(editorSelector)).toHaveText("Programmatic draft patch");
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

test("an entirely replaced editor never receives a pending transcript", async ({ page }) => {
  await transcript(page, "patch", 600);
  await open(page);
  await select(page, 11);
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
  await page.locator(editorSelector).evaluate((editor) => {
    const next = editor.cloneNode(false); next.textContent = "New editor"; editor.replaceWith(next);
  });
  await expect(page.getByRole("button", { name: idleName, exact: true })).toBeEnabled();
  await page.waitForTimeout(700);
  await expect(page.locator(editorSelector)).toHaveText("New editor");
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

test("question textarea selection is replaced through a native input event without sending", async ({ page }) => {
  await transcript(page, "patch");
  await page.goto("/project/session");
  await page.evaluate(() => {
    const parent = document.createElement("div");
    parent.innerHTML = '<textarea data-slot="question-custom-input">before WRONG after</textarea>';
    document.body.appendChild(parent);
    const input = parent.querySelector("textarea")!;
    Object.assign(window, { questionEvents: 0 });
    input.addEventListener("input", () => { const w = window as unknown as { questionEvents: number }; w.questionEvents++; });
    input.focus(); input.setSelectionRange(7, 12);
  });
  await record(page);
  await finish(page);
  await expect(page.locator("textarea")).toHaveValue("before patch after");
  expect(await page.evaluate("window.questionEvents")).toBe(1);
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

test("text-node segmentation changes with identical HTML do not reuse a wrong offset", async ({ page }) => {
  await transcript(page, "patch", 600);
  await open(page);
  await page.locator(editorSelector).evaluate((editor) => {
    editor.replaceChildren(document.createTextNode("a"), document.createTextNode("bcd"), document.createTextNode("ef"));
    (editor as HTMLElement).focus();
    window.getSelection()!.setBaseAndExtent(editor.childNodes[1], 1, editor.childNodes[1], 1);
  });
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
  await page.locator(editorSelector).evaluate((editor) => {
    editor.replaceChildren(document.createTextNode("ab"), document.createTextNode("cd"), document.createTextNode("ef"));
  });
  await expect(page.getByRole("button", { name: idleName, exact: true })).toBeEnabled();
  await expect(page.locator(editorSelector)).toHaveText("abcdef patch");
  expect(await page.evaluate("window.sendCount")).toBe(0);
});
