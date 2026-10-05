import { expect, test } from "@playwright/test";

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

test("injected mic records without GM APIs, preserves mentions and does not auto-send", async ({ page, request }) => {
  await page.goto("/project/session");
  await expect(page.locator(".ocvd-btn")).toHaveCount(1);
  await expect(page.locator(".ocvd-settings")).toHaveAttribute("href", "/voice/");
  await page.locator(".ocvd-btn").tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Stop recording");
  await page.waitForTimeout(200);
  await page.locator(".ocvd-btn").tap();
  await expect(page.locator('[data-component="composer-editor"]')).toContainText("Hello 你好 <img onerror=bad()>");
  await expect(page.locator("[data-mention]")).toHaveCount(1);
  await expect(page.locator('[data-component="composer-editor"] img')).toHaveCount(0);
  expect(await page.evaluate("window.sendCount")).toBe(0);
  expect((await (await request.get("/__test/state")).json()).lastModel).toBe("whisper-large-v3-turbo");
  expect(await page.evaluate("Object.keys(localStorage)")).toEqual([]);
});

test("settings save through REST and take effect without restarting Bun", async ({ page, request }) => {
  await page.goto("/voice/");
  await expect(page.locator("#fields")).toBeEnabled();
  await page.locator("#model").fill("whisper-large-v3");
  await page.locator("#language").fill("zh");
  await page.getByRole("button", { name: "Save settings" }).tap();
  await expect(page.locator("#status")).toHaveText("Settings saved.");
  const config = await (await request.get("/voice/config")).json();
  expect(config.settings.model).toBe("whisper-large-v3");
  expect(config.settings.language).toBe("zh");
  expect(JSON.stringify(config)).not.toContain("test-key-never-sent-to-browser");
});

test("switching sessions cancels a pending transcript instead of writing into the new input", async ({ page, request }) => {
  await request.post("/__test/delay");
  await page.goto("/project/session");
  await page.locator(".ocvd-btn").tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Stop recording");
  await page.waitForTimeout(200);
  await page.locator(".ocvd-btn").tap();
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Transcribing...");
  await page.evaluate(() => {
    history.pushState({}, "", "/project/another-session");
    const editor = document.querySelector('[data-component="composer-editor"]');
    if (editor) editor.textContent = "New session";
  });
  await expect(page.locator(".ocvd-btn")).toHaveAttribute("title", "Voice Dictation (Ctrl+Space)");
  await page.waitForTimeout(1100);
  await expect(page.locator('[data-component="composer-editor"]')).toHaveText("New session");
});
