import { expect, test } from "@playwright/test";

// Framework focus handlers can synchronously replace editor children. A Range
// created before focus would silently move to offset zero even for identical HTML.
for (const action of ["Stop and review", "Transcribe and send"]) {
  for (const changed of [false, true]) {
    test(`${action}: focus-time ${changed ? "draft change falls back to review" : "identical rerender preserves cursor"}`, async ({ page, request }) => {
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
      await page.route("**/voice/transcribe", (route) => route.fulfill({
        contentType: "application/json", body: JSON.stringify({ text: "the login bug" }),
      }));
      await page.goto("/project/session");
      const editor = page.locator('[data-component="composer-editor"]');
      await editor.fill("Please fix before committing.");
      await editor.evaluate((element) => {
        (element as HTMLElement).focus();
        window.getSelection()!.setBaseAndExtent(element.firstChild!, 11, element.firstChild!, 11);
      });
      await page.getByRole("button", { name: "Voice Dictation (Ctrl+Space)", exact: true }).tap();
      await expect(page.getByRole("button", { name: "Stop and review", exact: true })).toBeVisible();
      await page.waitForTimeout(150);
      // Install only after recording starts so the event is triggered by insertion.
      await editor.evaluate((element, changed) => {
        element.addEventListener("focus", () => {
          if (changed) element.textContent = "Updated on focus.";
          else element.innerHTML = element.innerHTML;
        }, { once: true });
      }, changed);
      await page.getByRole("button", { name: action, exact: true }).tap();
      await expect(page.getByRole("button", { name: "Voice Dictation (Ctrl+Space)", exact: true })).toBeEnabled();
      await expect(editor).toHaveText(changed ? "Updated on focus. the login bug" : "Please fix the login bug before committing.");
      expect(await page.evaluate("window.sendCount")).toBe(!changed && action === "Transcribe and send" ? 1 : 0);
      if (changed) await expect(page.locator("#opencode-voice-toast")).toContainText("send manually");
    });
  }
}
