import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const script = readFileSync("dist/opencode-voice-dictation.user.js", "utf8");
const fixture = `<!doctype html><title>OpenCode composer fixture</title>
<form data-component="prompt-input-v2">
  <div data-slot="prompt-attachments">image.png</div>
  <div data-component="prompt-input" contenteditable="true" role="textbox">Review <span data-mention="file" data-path="src/a.ts" contenteditable="false">@a.ts</span></div>
  <button type="button" data-action="prompt-submit" data-icon="arrow-up">Send</button>
</form><output id="framework-value"></output><output id="sent">0</output>
<script>
// Mirrors the verified V2 input contract: parse DOM on input, preserve attached parts.
const editor = document.querySelector('[data-component="prompt-input"]');
editor.addEventListener('input', () => {
  document.querySelector('#framework-value').textContent = editor.textContent;
});
document.querySelector('[data-action="prompt-submit"]').onclick = () => {
  document.querySelector('#sent').textContent = String(+document.querySelector('#sent').textContent + 1);
};
</script>`;

test.beforeEach(async ({ page }, testInfo) => {
  const html =
    testInfo.project.name === "renamed-composer"
      ? fixture
          .replaceAll('data-component="prompt-input-v2"', 'data-component="composer"')
          .replaceAll('data-component="prompt-input"', 'data-component="composer-editor"')
          .replaceAll('data-action="prompt-submit"', 'data-action="composer-submit"')
          .replace(
            'data-icon="arrow-up">Send',
            '><svg data-slot="icon-svg"><use href="#opencode-v2-icon-arrow-up"></use></svg>Send',
          )
      : fixture;
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("https://opencode-fixture.test/project/session/first");
  await page.evaluate(() => {
    const store: Record<string, unknown> = { groqApiKey: "TEST_ONLY_NOT_A_REAL_KEY" };
    Object.assign(window, {
      GM_getValue: (key: string, fallback: unknown) => store[key] ?? fallback,
      GM_setValue: (key: string, value: unknown) => {
        store[key] = value;
      },
      GM_registerMenuCommand: () => {},
      GM_xmlhttpRequest: (details: { onload: (data: unknown) => void }) => {
        Object.assign(window, {
          respond: () => details.onload({ status: 200, responseText: "add tests" }),
        });
        return { abort() {} };
      },
      setAutoSubmit: () => {
        store.autoSubmit = true;
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    });
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["synthetic fixture"]) });
        this.onstop?.();
      }
    }
    Object.assign(window, { MediaRecorder: Recorder });
  });
  await page.addScriptTag({ content: script });
});

test("real Chromium input appends and retains rich nodes and attachment DOM", async ({ page }) => {
  const mic = page.locator(".ocvd-btn");
  await mic.click();
  await expect(mic).toHaveClass(/recording/);
  await mic.click();
  await expect(mic).toHaveClass(/processing/);
  await page.evaluate("window.respond()");
  await expect(page.locator("#framework-value")).toHaveText("Review @a.ts add tests");
  await expect(page.locator('[data-mention="file"]')).toHaveAttribute("data-path", "src/a.ts");
  await expect(page.locator('[data-slot="prompt-attachments"]')).toHaveText("image.png");
  await expect(page.locator("#sent")).toHaveText("0");
  await expect(mic).toHaveClass("ocvd-btn");
});

test("opt-in auto-submit uses the original session's Send button", async ({ page }) => {
  await page.evaluate("window.setAutoSubmit()");
  const mic = page.locator(".ocvd-btn");
  await mic.click();
  await expect(mic).toHaveClass(/recording/);
  await mic.click();
  await expect(mic).toHaveClass(/processing/);
  await page.evaluate("window.respond()");
  await expect(page.locator("#sent")).toHaveText("1");
});

test("switching sessions cancels pending transcription and late results", async ({ page }) => {
  await page.evaluate("window.setAutoSubmit()");
  const mic = page.locator(".ocvd-btn");
  await mic.click();
  await expect(mic).toHaveClass(/recording/);
  await mic.click();
  await expect(mic).toHaveClass(/processing/);
  await page.evaluate(() => {
    history.pushState({}, "", "/project/session/second");
    window.dispatchEvent(new Event("urlchange"));
  });
  await page.evaluate("window.respond()");
  await expect(
    page.locator('[data-component="prompt-input"], [data-component="composer-editor"]'),
  ).toHaveText("Review @a.ts");
  await expect(page.locator("#sent")).toHaveText("0");
  await expect(mic).toHaveClass("ocvd-btn");
});

test("shipping metadata is inert until explicitly scoped and update URLs stay on the fork", () => {
  const matches = [...script.matchAll(/^\/\/\s+@match\s+(.+)$/gm)].map((match) => match[1].trim());
  expect(matches).toEqual(["https://opencode.invalid/*"]);
  expect(script).toContain("@noframes");
  expect(script).toContain(
    "https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/dist/",
  );
  expect(script).not.toContain("setTimeout(init, 1500)");
});
