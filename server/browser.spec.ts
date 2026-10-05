import { expect, test, type Page } from "@playwright/test";

const editorSelector = '[data-component="composer-editor"], [data-component="prompt-input"][contenteditable]';
const nativeSelector = 'button[data-action="composer-submit"], button[data-action="prompt-submit"]';

test.beforeEach(async ({ page, request }) => {
  await request.post("/__test/reset");
  await page.addInitScript(() => {
    // Real MediaRecorder encoding, but never a real microphone or external provider.
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const context = new AudioContext();
      const source = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      source.connect(destination); source.start();
      await context.resume();
      return destination.stream;
    } });
  });
});

async function record(page: Page) {
  await page.getByRole("button", { name: "Voice Dictation (Ctrl+Space)", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Stop and review", exact: true })).toBeVisible();
  await page.waitForTimeout(200);
}
async function idle(page: Page) {
  await expect(page.getByRole("button", { name: "Voice Dictation (Ctrl+Space)", exact: true })).toBeEnabled();
}

// Model OpenCode's reactive composer: the native button is disabled until an input
// event reaches the app, and may not become enabled until a later render.
async function reactiveComposer(page: Page, delay = 0) {
  await page.evaluate(({ editorSelector, nativeSelector, delay }) => {
    const editor = document.querySelector<HTMLElement>(editorSelector)!;
    const button = document.querySelector<HTMLButtonElement>(nativeSelector)!;
    const stats = { inputEvents: 0, sentText: "" };
    Object.assign(window, { fixtureStats: stats });
    editor.textContent = "";
    button.disabled = true;
    editor.addEventListener("input", () => {
      stats.inputEvents++;
      setTimeout(() => { button.disabled = !editor.textContent?.trim(); }, delay);
    });
    button.addEventListener("click", () => { stats.sentText = editor.textContent ?? ""; });
  }, { editorSelector, nativeSelector, delay });
}

test("Stop inserts editable text, enables native Send, and ignores legacy auto-submit=true", async ({ page, request }) => {
  await request.patch("/voice/config", { headers: { "X-OCVD-Request": "1" }, data: { autoSubmit: true } });
  await page.goto("/project/session");
  await reactiveComposer(page);
  await expect(page.locator(nativeSelector)).toBeDisabled();
  await expect(page.locator(".ocvd-send")).toBeHidden();
  await record(page);
  await page.getByRole("button", { name: "Stop and review", exact: true }).tap();
  await idle(page);
  await expect(page.locator(editorSelector)).toContainText("Hello 你好 <img onerror=bad()>");
  await expect(page.locator(nativeSelector)).toBeEnabled();
  expect(await page.evaluate("window.fixtureStats.inputEvents")).toBeGreaterThan(0);
  expect(await page.evaluate("window.sendCount")).toBe(0);
  await page.locator(editorSelector).fill("My edited draft");
  await expect(page.locator(editorSelector)).toHaveText("My edited draft");
  await page.locator(editorSelector).fill("");
  await expect(page.locator(nativeSelector)).toBeDisabled();
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

test("review preserves rich text and settings; no GM APIs or browser key storage", async ({ page, request }) => {
  await page.goto("/project/session");
  await expect(page.locator(".ocvd-btn")).toHaveCount(1);
  await expect(page.locator(".ocvd-settings")).toHaveAttribute("href", "/voice/");
  await record(page);
  await page.getByRole("button", { name: "Stop and review", exact: true }).tap();
  await idle(page);
  await expect(page.locator(editorSelector)).toContainText("Hello 你好 <img onerror=bad()>");
  await expect(page.locator("[data-mention]")).toHaveCount(1);
  await expect(page.locator(`${editorSelector.split(",")[0]} img`)).toHaveCount(0);
  expect(await page.evaluate("window.sendCount")).toBe(0);
  expect((await (await request.get("/__test/state")).json()).lastModel).toBe("whisper-large-v3-turbo");
  expect(await page.evaluate("Object.keys(localStorage)")).toEqual([]);
});

for (const dialect of ["beta", "stable"]) {
  test(`direct send waits for native input state and sends once (${dialect})`, async ({ page, request }) => {
    await page.goto("/project/session");
    if (dialect === "stable") {
      await page.evaluate(() => {
        document.querySelector("form")!.dataset.component = "prompt-input-v2";
        document.querySelector<HTMLElement>('[data-component="composer-editor"]')!.dataset.component = "prompt-input";
        document.querySelector<HTMLElement>('[data-action="composer-submit"]')!.dataset.action = "prompt-submit";
        document.querySelector(".ocvd-container")?.remove();
      });
    } else {
      // The beta layout may use the sprite icon rather than data-icon.
      await page.evaluate(() => {
        const button = document.querySelector('[data-action="composer-submit"]')!;
        button.removeAttribute("data-icon");
        button.innerHTML = '<svg data-slot="icon-svg"><use href="#opencode-v2-icon-arrow-up"></use></svg>';
      });
    }
    await reactiveComposer(page, 250);
    await record(page);
    await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
    await expect.poll(() => page.evaluate("window.sendCount")).toBe(1);
    await idle(page);
    expect(await page.evaluate("window.fixtureStats.sentText")).toContain("Hello 你好");
    expect((await (await request.get("/__test/state")).json()).calls).toBe(1);
    await expect(page.locator(".ocvd-send")).toBeHidden();
    // The action is per recording, not a sticky global preference.
    await record(page);
    await page.getByRole("button", { name: "Stop and review", exact: true }).tap();
    await idle(page);
    expect(await page.evaluate("window.sendCount")).toBe(1);
  });
}

test("direct send includes the existing draft and preserves mentions", async ({ page }) => {
  await page.goto("/project/session");
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await idle(page);
  expect(await page.evaluate("window.sendCount")).toBe(1);
  await expect(page.locator(editorSelector)).toContainText("@context existing Hello 你好");
  await expect(page.locator("[data-mention]")).toHaveCount(1);
});

test("duplicate clicks cannot submit or transcribe twice", async ({ page, request }) => {
  await request.post("/__test/delay");
  await page.goto("/project/session");
  await record(page);
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(".ocvd-send")!;
    button.click();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector<HTMLButtonElement>(".ocvd-btn")!.click();
  });
  await idle(page);
  expect(await page.evaluate("window.sendCount")).toBe(1);
  expect((await (await request.get("/__test/state")).json()).calls).toBe(1);
});

for (const blocked of ["stop", "terminal", "disabled", "aria-disabled"]) {
  test(`direct send preserves the draft when native action is ${blocked}`, async ({ page }) => {
    await page.goto("/project/session");
    await page.evaluate((blocked) => {
      const button = document.querySelector<HTMLButtonElement>('[data-action="composer-submit"]')!;
      if (blocked === "disabled") button.disabled = true;
      else if (blocked === "aria-disabled") button.setAttribute("aria-disabled", "true");
      else button.dataset.icon = blocked;
    }, blocked);
    await record(page);
    if (blocked === "stop" || blocked === "terminal") {
      // Stop/shell retain their native meaning; no extra send control is injected.
      await expect(page.getByRole("button", { name: "Transcribe and send", exact: true })).toHaveCount(0);
      await expect(page.locator(nativeSelector)).toHaveAttribute("data-icon", blocked);
      await page.getByRole("button", { name: "Stop and review", exact: true }).tap();
    } else {
      await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
    }
    await idle(page);
    await expect(page.locator(editorSelector)).toContainText("Hello 你好");
    expect(await page.evaluate("window.sendCount")).toBe(0);
    if (blocked === "disabled" || blocked === "aria-disabled") {
      await expect(page.locator("#opencode-voice-toast")).toContainText("Send is unavailable");
    }
  });
}

test("editing while transcription is pending downgrades direct send to review", async ({ page, request }) => {
  await request.post("/__test/delay");
  await page.goto("/project/session");
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
  await page.locator(editorSelector).fill("Additional context");
  await idle(page);
  await expect(page.locator(editorSelector)).toContainText("Additional context Hello 你好");
  expect(await page.evaluate("window.sendCount")).toBe(0);
  await expect(page.locator("#opencode-voice-toast")).toContainText("Draft changed");
});

for (const action of ["Stop and review", "Transcribe and send"]) {
  test(`session switch cancels ${action}`, async ({ page, request }) => {
    await request.post("/__test/delay");
    await page.goto("/project/session");
    await record(page);
    await page.getByRole("button", { name: action, exact: true }).tap();
    await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
    await page.evaluate(() => {
      history.pushState({}, "", "/project/another-session");
      document.querySelector<HTMLElement>('[data-component="composer-editor"]')!.textContent = "New session";
    });
    await idle(page);
    await page.waitForTimeout(1100);
    await expect(page.locator(editorSelector)).toHaveText("New session");
    expect(await page.evaluate("window.sendCount")).toBe(0);
  });
}

test("Cancel while recording discards audio without uploading", async ({ page, request }) => {
  await page.goto("/project/session");
  await record(page);
  await page.getByRole("button", { name: "Cancel dictation", exact: true }).tap();
  await idle(page);
  expect((await (await request.get("/__test/state")).json()).calls).toBe(0);
  await expect(page.locator(editorSelector)).toHaveText("@context existing");
});

test("Cancel during transcription prevents direct send", async ({ page, request }) => {
  await request.post("/__test/delay");
  await page.goto("/project/session");
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
  await page.getByRole("button", { name: "Cancel dictation", exact: true }).tap();
  await idle(page);
  await page.waitForTimeout(1100);
  expect(await page.evaluate("window.sendCount")).toBe(0);
  await expect(page.locator(editorSelector)).toHaveText("@context existing");
});

test("Cancel while waiting for native Send leaves the inserted draft intact", async ({ page }) => {
  await page.goto("/project/session");
  await reactiveComposer(page, 800);
  await record(page);
  await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
  await expect(page.locator(editorSelector)).toContainText("Hello 你好");
  await page.getByRole("button", { name: "Cancel dictation", exact: true }).tap();
  await idle(page);
  await page.waitForTimeout(1000);
  expect(await page.evaluate("window.sendCount")).toBe(0);
  await expect(page.locator(editorSelector)).toContainText("Hello 你好");
});

for (const failed of [false, true]) {
  test(`${failed ? "provider error" : "empty transcript"} never sends the existing draft`, async ({ page }) => {
    await page.route("**/voice/transcribe", (route) => route.fulfill({
      status: failed ? 502 : 200, contentType: "application/json",
      body: JSON.stringify(failed ? { error: "Provider unavailable" } : { text: "  ", autoSubmit: true }),
    }));
    await page.goto("/project/session");
    await record(page);
    await page.getByRole("button", { name: "Transcribe and send", exact: true }).tap();
    await idle(page);
    expect(await page.evaluate("window.sendCount")).toBe(0);
    await expect(page.locator(editorSelector)).toHaveText("@context existing");
  });
}

test("duration limit always stops for review, even with legacy auto-submit enabled", async ({ page, request }) => {
  await request.patch("/voice/config", { headers: { "X-OCVD-Request": "1" }, data: { autoSubmit: true } });
  await page.route("**/voice/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), maxRecordingSeconds: 1 } });
  });
  await page.goto("/project/session");
  await record(page);
  await idle(page);
  await expect(page.locator(editorSelector)).toContainText("Hello 你好");
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

test("question dictation only offers review, never a direct-send action", async ({ page }) => {
  await page.goto("/project/session");
  await page.evaluate(() => {
    const parent = document.createElement("div");
    parent.innerHTML = '<textarea data-slot="question-custom-input"></textarea>';
    document.body.appendChild(parent);
  });
  await expect(page.locator('.ocvd-container[data-target="question"]')).toHaveCount(1);
  await record(page);
  await expect(page.getByRole("button", { name: "Transcribe and send", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Stop and review", exact: true }).tap();
  await idle(page);
  await expect(page.locator("textarea")).toHaveValue("Hello 你好 <img onerror=bad()>");
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

test("controls survive replacement and timer rendering without duplicate buttons", async ({ page }) => {
  await page.goto("/project/session");
  await record(page);
  await page.evaluate(() => document.querySelector(".ocvd-container")!.remove());
  await page.waitForTimeout(1100);
  await expect(page.getByRole("button", { name: "Stop and review", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Transcribe and send", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Stop and review", exact: true }).tap();
  await idle(page);
  expect(await page.evaluate("window.sendCount")).toBe(0);
});

test("settings persist through REST without a global auto-send switch", async ({ page, request }) => {
  await page.goto("/voice/");
  await expect(page.locator("#fields")).toBeEnabled();
  await expect(page.locator("#autoSubmit")).toHaveCount(0);
  await expect(page.getByText("Stop and review", { exact: true })).toBeVisible();
  await page.locator("#model").fill("whisper-large-v3");
  await page.locator("#language").fill("zh");
  await page.getByRole("button", { name: "Save settings" }).tap();
  await expect(page.locator("#status")).toHaveText("Settings saved.");
  const config = await (await request.get("/voice/config")).json();
  expect(config.settings.model).toBe("whisper-large-v3");
  expect(config.settings.language).toBe("zh");
  expect(JSON.stringify(config)).not.toContain("test-key-never-sent-to-browser");
});

test("recording borrows the original button, never inserts or clones a Send button", async ({ page }) => {
  await page.goto("/project/session");
  await reactiveComposer(page);
  const before = await page.locator("button").count();
  await page.evaluate((selector) => {
    const button = document.querySelector<HTMLButtonElement>(selector)!;
    button.title = "Original title"; button.setAttribute("aria-label", "Original Send");
    Object.assign(window, { originalButton: button, originalClick: button.onclick });
  }, nativeSelector);
  await record(page);
  expect(await page.locator("button").count()).toBe(before);
  await expect(page.locator(".ocvd-container .ocvd-send")).toHaveCount(0);
  await expect(page.locator(nativeSelector)).toBeEnabled();
  expect(await page.evaluate((selector) => {
    const saved = window as unknown as { originalButton: HTMLButtonElement; originalClick: unknown };
    const button = document.querySelector<HTMLButtonElement>(selector)!;
    return button === saved.originalButton && button.onclick === saved.originalClick;
  }, nativeSelector)).toBe(true);
  await page.getByRole("button", { name: "Cancel dictation", exact: true }).tap();
  await idle(page);
  await expect(page.locator(nativeSelector)).toBeDisabled();
  await expect(page.locator(nativeSelector)).toHaveAttribute("title", "Original title");
  await expect(page.locator(nativeSelector)).toHaveAttribute("aria-label", "Original Send");
  expect(await page.locator(nativeSelector).evaluate((button) => Object.hasOwn(button, "disabled"))).toBe(false);
  await page.locator(editorSelector).fill("Normal manually typed draft");
  await expect(page.locator(nativeSelector)).toBeEnabled();
  await page.locator(nativeSelector).tap();
  expect(await page.evaluate("window.sendCount")).toBe(1);
});

test("cancellation preserves same-value framework disabled writes and new labels", async ({ page }) => {
  await page.goto("/project/session");
  await reactiveComposer(page);
  await record(page);
  await page.evaluate((selector) => {
    const button = document.querySelector<HTMLButtonElement>(selector)!;
    button.disabled = false; // Already enabled by voice: still real app state.
    button.title = "New native title";
    button.setAttribute("aria-label", "New native label");
  }, nativeSelector);
  await page.getByRole("button", { name: "Cancel dictation", exact: true }).tap();
  await idle(page);
  await expect(page.locator(nativeSelector)).toBeEnabled();
  await expect(page.locator(nativeSelector)).toHaveAttribute("title", "New native title");
  await expect(page.locator(nativeSelector)).toHaveAttribute("aria-label", "New native label");
});

test("replacement native button is intercepted without losing its own click listener", async ({ page }) => {
  await page.goto("/project/session");
  await record(page);
  await page.evaluate((selector) => {
    const old = document.querySelector(selector)!;
    const fresh = document.createElement("button");
    fresh.type = "button"; fresh.dataset.action = "composer-submit"; fresh.dataset.icon = "arrow-up";
    fresh.textContent = "Send";
    fresh.onclick = () => { const w = window as unknown as { sendCount: number }; w.sendCount++; };
    old.replaceWith(fresh);
  }, nativeSelector);
  await expect(page.locator(nativeSelector)).toHaveAttribute("aria-label", "Transcribe and send");
  await page.locator(nativeSelector).tap();
  await idle(page);
  expect(await page.evaluate("window.sendCount")).toBe(1);
});

test("an agent Stop action appearing mid-recording is never intercepted", async ({ page, request }) => {
  await page.goto("/project/session");
  await record(page);
  await page.locator(nativeSelector).evaluate((button) => button.setAttribute("data-icon", "stop"));
  await expect(page.getByRole("button", { name: "Transcribe and send", exact: true })).toHaveCount(0);
  await page.locator(nativeSelector).tap();
  expect(await page.evaluate("window.sendCount")).toBe(1); // Original native handler.
  expect((await (await request.get("/__test/state")).json()).calls).toBe(0);
  await page.getByRole("button", { name: "Cancel dictation", exact: true }).tap();
});

test("form submission and repeated clicks cannot send a draft before transcription", async ({ page, request }) => {
  await request.post("/__test/delay");
  await page.goto("/project/session");
  await page.evaluate((selector) => {
    document.querySelector<HTMLButtonElement>(selector)!.type = "submit";
    document.querySelector("form")!.addEventListener("submit", (event) => event.preventDefault());
  }, nativeSelector);
  await record(page);
  await page.evaluate((selector) => {
    const button = document.querySelector<HTMLButtonElement>(selector)!;
    button.form!.requestSubmit(button);
    button.click();
    button.form!.requestSubmit(button);
  }, nativeSelector);
  expect(await page.evaluate("window.sendCount")).toBe(0);
  await idle(page);
  expect(await page.evaluate("window.sendCount")).toBe(1);
  expect((await (await request.get("/__test/state")).json()).calls).toBe(1);
});

test("Enter in the editor transcribes instead of submitting the untranscribed draft", async ({ page, request }) => {
  await request.post("/__test/delay");
  await page.goto("/project/session");
  await page.evaluate((selector) => {
    document.querySelector(selector)!.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        const w = window as unknown as { sendCount: number }; w.sendCount++;
      }
    });
  }, editorSelector);
  await record(page);
  await page.locator(editorSelector).focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate("window.sendCount")).toBe(0);
  await idle(page);
  expect(await page.evaluate("window.sendCount")).toBe(1);
});

test("pagehide releases the temporary button override", async ({ page }) => {
  await page.goto("/project/session");
  await reactiveComposer(page);
  await record(page);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await idle(page);
  await expect(page.locator(nativeSelector)).toBeDisabled();
  expect(await page.locator(nativeSelector).getAttribute("data-ocvd-native-phase")).toBeNull();
  expect(await page.locator(nativeSelector).evaluate((button) => Object.hasOwn(button, "disabled"))).toBe(false);
});
