import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const script = readFileSync("dist/opencode-voice-dictation.user.js", "utf8");
// Native row geometry from OpenCode 907b3bc / e5ecb571. No original user page data.
const send = `<button type="button" data-action="prompt-submit" data-icon="arrow-up" aria-label="Send"><svg data-slot="icon-svg" viewBox="0 0 16 16"><path d="M8 13V3M3 8l5-5 5 5" fill="none" stroke="currentColor"/></svg></button>`;
const fixture = `<!doctype html><title>OpenCode composer fixture</title>
<style>
* { box-sizing: border-box; }
body { margin: 12px; font-family: sans-serif; }
form { max-width: 720px; margin: 80px auto 0; border: 1px solid #999; border-radius: 12px; }
[contenteditable=true] { min-height: 76px; padding: 16px; }
[data-fixture=toolbar] { display: flex; height: 44px; align-items: center; padding: 0 8px; }
[data-fixture=model-controls] { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; }
[data-slot=composer-actions], [data-component=tooltip-v2-trigger] { display: flex; flex-shrink: 0; align-items: center; }
button[data-action$="-attach"], button[data-action$="-submit"] { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 6px; border: 0; border-radius: 6px; cursor: default; }
button[data-action$="-attach"] svg, button[data-action$="-submit"] svg { width: 16px; height: 16px; flex-shrink: 0; }
[data-fixture=selector] { height: 28px; border: 0; padding: 0 11px; flex-shrink: 0; }
</style>
<form data-component="prompt-input-v2">
  <div data-slot="prompt-attachments">image.png</div>
  <div data-component="prompt-input" contenteditable="true" role="textbox">Review <span data-mention="file" data-path="src/a.ts" contenteditable="false">@a.ts</span></div>
  <div data-fixture="toolbar">
    <div data-fixture="model-controls"><button type="button" data-action="prompt-attach" aria-label="Add images and files"><svg viewBox="0 0 16 16"><path d="M8 2v12M2 8h12"/></svg></button><button type="button" data-fixture="selector">Model</button></div>
    <div data-component="tooltip-v2-trigger">${send}</div>
  </div>
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
          .replaceAll('data-action="prompt-attach"', 'data-action="composer-attach"')
          .replaceAll('data-action="prompt-submit"', 'data-action="composer-submit"')
          .replace('data-icon="arrow-up"', 'data-component="icon-button-v2"')
          .replace(/<path d="M8 13V3[^>]+\/>/, '<use href="#opencode-v2-icon-arrow-up"></use>')
          .replace(
            '<div data-component="tooltip-v2-trigger">',
            '<div data-slot="composer-actions"><div data-component="tooltip-v2-trigger">',
          )
          .replace("</button></div>\n  </div>", "</button></div></div>\n  </div>")
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

for (const width of [1024, 320]) {
  test(`native action-row alignment, hover and recording controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    const mic = page.locator(".ocvd-btn");
    const submit = page.locator('button[data-action$="-submit"]');
    await mic.hover();
    await expect(mic).toHaveCSS("cursor", "default");
    await expect(page.locator(".ocvd-container")).toHaveCSS("position", "static");
    const inspect = () =>
      page.evaluate(() => {
        const mic = document.querySelector(".ocvd-btn") as HTMLElement;
        const submit = document.querySelector('button[data-action$="-submit"]') as HTMLElement;
        const container = mic.parentElement;
        const anchor = submit.parentElement;
        const box = (element: Element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        };
        return {
          adjacent: container?.nextElementSibling === anchor,
          separateTooltip: !anchor?.contains(mic),
          mic: box(mic),
          submit: box(submit),
          icon: box(mic.querySelector("svg") as SVGElement),
          nativeIcon: box(submit.querySelector("svg") as SVGElement),
          padding: getComputedStyle(mic).padding,
          nativePadding: getComputedStyle(submit).padding,
          radius: getComputedStyle(mic).borderRadius,
          nativeRadius: getComputedStyle(submit).borderRadius,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
    const assertAligned = async () => {
      const view = await inspect();
      expect(view.adjacent).toBe(true);
      expect(view.separateTooltip).toBe(true);
      expect(view.mic.width).toBeGreaterThan(0);
      expect(view.mic.width).toBe(view.submit.width);
      expect(view.mic.height).toBe(view.submit.height);
      expect(view.mic.y).toBe(view.submit.y);
      expect(view.mic.x + view.mic.width).toBeLessThanOrEqual(view.submit.x);
      expect(view.icon.width).toBe(view.nativeIcon.width);
      expect(view.icon.height).toBe(view.nativeIcon.height);
      expect(view.padding).toBe(view.nativePadding);
      expect(view.radius).toBe(view.nativeRadius);
      expect(view.overflow).toBe(false);
    };
    await assertAligned();
    await mic.click();
    await expect(mic).toHaveClass(/recording/);
    await assertAligned();
    const cancel = page.locator(".ocvd-cancel");
    await cancel.hover();
    await expect(cancel).toHaveCSS("cursor", "default");
    await expect(cancel).toHaveCSS("width", "28px");
    await cancel.click();
    await expect(mic).toHaveClass("ocvd-btn");
    // A native style/size change must be followed without polling or reinjection.
    await submit.evaluate((button) => {
      button.style.width = "32px";
      button.style.height = "32px";
      button.style.padding = "8px";
      button.style.borderRadius = "8px";
    });
    await expect(mic).toHaveCSS("width", "32px");
    await assertAligned();
  });
}

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

for (const direction of ["ltr", "rtl"]) {
  test(`matches Add/selector visible spacing without doubling row gap (${direction})`, async ({
    page,
  }) => {
    await page.evaluate((dir) => {
      document.documentElement.dir = dir;
    }, direction);
    const inspect = () =>
      page.evaluate(() => {
        const rect = (selector: string) =>
          (document.querySelector(selector) as Element).getBoundingClientRect();
        const rtl = document.documentElement.dir === "rtl";
        const add = rect('button[data-action$="-attach"] svg');
        const selector = rect('[data-fixture="selector"]');
        const padding = Number.parseFloat(
          getComputedStyle(document.querySelector('[data-fixture="selector"]') as Element)
            .paddingInlineStart,
        );
        const mic = rect(".ocvd-btn svg");
        const send = rect('button[data-action$="-submit"] svg');
        return {
          reference: rtl
            ? add.left - selector.right + padding
            : selector.left + padding - add.right,
          actual: rtl ? mic.left - send.right : send.left - mic.right,
        };
      });
    for (const width of [1024, 320]) {
      await page.setViewportSize({ width, height: 720 });
      for (const gap of [0, 3, 12]) {
        await page.locator(".ocvd-container").evaluate((container, gap) => {
          (container.parentElement as HTMLElement).style.columnGap = `${gap}px`;
          window.dispatchEvent(new Event("resize"));
        }, gap);
        await expect
          .poll(async () => {
            const x = await inspect();
            return Math.abs(x.reference - x.actual);
          })
          .toBeLessThan(0.1);
      }
    }
    await page.locator(".ocvd-btn").click();
    const view = await inspect();
    expect(view.actual).toBeCloseTo(view.reference, 1);
    await page.locator(".ocvd-cancel").click();
  });
}
