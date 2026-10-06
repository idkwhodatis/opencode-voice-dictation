import { expect, test, type Page } from "@playwright/test";

const groqEndpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
const secret = "TEST_ONLY_NEVER_A_REAL_PROVIDER_KEY";
interface ProviderMetadata {
  provider: "groq" | "custom";
  endpoint: string;
  apiKeyConfigured: boolean;
  source: "encrypted" | "legacy" | "none";
  error?: string;
}
interface ProviderUpdate {
  provider: "groq" | "custom";
  endpoint: string;
  apiKey?: string | null;
}

async function mockProvider(page: Page, initial: Partial<ProviderMetadata> = {}) {
  const state = {
    saved: {
      provider: "groq",
      endpoint: groqEndpoint,
      apiKeyConfigured: true,
      source: "encrypted",
      ...initial,
    } as ProviderMetadata,
    updates: [] as ProviderUpdate[],
    reads: 0,
    failRead: false,
    failWrite: false,
    writeGate: null as Promise<void> | null,
  };
  await page.route("**/voice/provider", async (route) => {
    const request = route.request();
    expect(request.headers()["x-ocvd-request"]).toBe("1");
    expect(request.headers()["content-type"]).toBe("application/json");
    if (request.method() === "GET") {
      state.reads++;
      expect(request.postData()).toBeNull();
      if (state.failRead) {
        await route.fulfill({ status: 503, json: { error: `Unavailable ${secret}` } });
      } else await route.fulfill({ json: state.saved });
      return;
    }
    expect(request.method()).toBe("PUT");
    const data = request.postDataJSON() as ProviderUpdate;
    state.updates.push(data);
    if (state.writeGate) await state.writeGate;
    if (state.failWrite) {
      await route.fulfill({ status: 400, json: { error: `Rejected key: ${secret}` } });
      return;
    }
    state.saved = {
      provider: data.provider,
      endpoint: data.endpoint,
      apiKeyConfigured: data.apiKey === null ? false : !!data.apiKey || state.saved.apiKeyConfigured,
      source: data.apiKey === null ? "none" : data.apiKey ? "encrypted" : state.saved.source,
    };
    await route.fulfill({ json: state.saved });
  });
  return state;
}
async function openSettings(page: Page) {
  await page.goto("/voice/");
  await expect(page.locator("#provider")).toBeEnabled();
  await expect(page.locator("#model")).toBeEnabled();
}
async function enterKey(page: Page, value = secret) {
  await page.locator("#edit-key").click();
  await expect(page.locator("#api-key")).toBeFocused();
  await page.locator("#api-key").fill(value);
}
async function expectNoBrowserKey(page: Page) {
  await expect(page.locator("#api-key")).toHaveValue("");
  expect(await page.evaluate(() => ({
    local: Object.keys(localStorage), session: Object.keys(sessionStorage),
  }))).toEqual({ local: [], session: [] });
  expect(await page.locator("body").innerText()).not.toContain(secret);
}

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("loads only provider metadata and keeps the existing key write-only", async ({ page }) => {
  const fixture = await mockProvider(page);
  await page.addInitScript(() => {
    const original = window.fetch;
    const options: { path: string; credentials?: RequestCredentials; cache?: RequestCache }[] = [];
    Object.assign(window, { fetchOptions: options });
    window.fetch = (input, init) => {
      options.push({ path: String(input), credentials: init?.credentials, cache: init?.cache });
      return original(input, init);
    };
  });
  await openSettings(page);
  await expect(page.locator("#provider")).toHaveValue("groq");
  await expect(page.locator("#endpoint-fields")).toBeHidden();
  await expect(page.locator("#key-status")).toContainText("configured and encrypted");
  await expect(page.getByRole("button", { name: "Change key", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove key", exact: true })).toBeEnabled();
  await expect(page.locator("#api-key")).toHaveAttribute("type", "password");
  await expect(page.locator("#api-key")).toHaveAttribute("autocomplete", "new-password");
  await expect(page.locator("#key-editor")).toBeHidden();
  await expectNoBrowserKey(page);
  expect(fixture.reads).toBe(1);
  expect(fixture.updates).toEqual([]);
  expect(await page.evaluate("window.fetchOptions")).toEqual([
    { path: "/voice/config", credentials: "same-origin", cache: "no-store" },
    { path: "/voice/provider", credentials: "same-origin", cache: "no-store" },
  ]);
});

test("adds, retains, rotates, and removes an encrypted key with explicit saves", async ({ page }) => {
  const fixture = await mockProvider(page, { apiKeyConfigured: false, source: "none" });
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Add key", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove key", exact: true })).toBeDisabled();
  await enterKey(page);
  expect(fixture.updates).toHaveLength(0);
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toHaveText("Provider settings saved.");
  expect(fixture.updates[0]).toEqual({ provider: "groq", endpoint: groqEndpoint, apiKey: secret });
  await expectNoBrowserKey(page);
  await expect(page.locator("#key-editor")).toBeHidden();
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toHaveText("Provider settings saved.");
  expect(fixture.updates[1]).toEqual({ provider: "groq", endpoint: groqEndpoint });
  await expect(page.locator("#key-status")).toContainText("configured and encrypted");
  await enterKey(page, `${secret}_ROTATED`);
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toHaveText("Provider settings saved.");
  expect(fixture.updates[2].apiKey).toBe(`${secret}_ROTATED`);
  await expectNoBrowserKey(page);
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await expect(page.locator("#provider-status")).toHaveText("API key removed.");
  expect(fixture.updates[3]).toEqual({ provider: "groq", endpoint: groqEndpoint, apiKey: null });
  await expect(page.locator("#key-status")).toContainText("No API key");
  await expect(page.getByRole("button", { name: "Add key", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove key", exact: true })).toBeDisabled();
  await expectNoBrowserKey(page);
});

test("requires a freshly entered key for each changed provider or endpoint", async ({ page }) => {
  const fixture = await mockProvider(page);
  await openSettings(page);
  await enterKey(page);
  await page.locator("#provider").selectOption("custom");
  await expectNoBrowserKey(page);
  await page.locator("#endpoint").fill("https://speech.example.test/v1/audio/transcriptions");
  await expect(page.locator("#target-warning")).toBeVisible();
  await expect(page.locator("#custom-warning")).toContainText("recordings and API key");
  await expect(page.locator("#http-warning")).toBeHidden();
  await expect(page.getByRole("button", { name: "Remove key", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toContainText("Enter a new API key");
  expect(fixture.updates).toEqual([]);
  await page.locator("#api-key").fill(secret);
  await page.locator("#endpoint").fill("https://other.example.test/custom/transcribe");
  await expectNoBrowserKey(page);
  await enterKey(page, `${secret}_CUSTOM`);
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toHaveText("Provider settings saved.");
  expect(fixture.updates).toEqual([{
    provider: "custom", endpoint: "https://other.example.test/custom/transcribe", apiKey: `${secret}_CUSTOM`,
  }]);
  await expect(page.locator("#target-warning")).toBeHidden();
  await expectNoBrowserKey(page);
  await page.locator("#provider").selectOption("groq");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toContainText("Enter a new API key");
  expect(fixture.updates).toHaveLength(1);
});

test("custom HTTP has a plaintext warning and preferences save independently", async ({ page, request }) => {
  const fixture = await mockProvider(page);
  await openSettings(page);
  await page.locator("#provider").selectOption("custom");
  await page.locator("#endpoint").fill("http://127.0.0.1:8000/v1/audio/transcriptions");
  await expect(page.locator("#http-warning")).toContainText("plaintext");
  await expect(page.locator("#endpoint-help")).toContainText("literal private or loopback");
  await enterKey(page);
  await page.locator("#model").fill("custom/stt-model:latest");
  await page.locator("#language").fill("zh");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("Settings saved.");
  expect(fixture.updates).toHaveLength(0);
  await expect(page.locator("#api-key")).toHaveValue(secret);
  const config = await (await request.get("/voice/config")).json();
  expect(config.settings.model).toBe("custom/stt-model:latest");
  expect(config.settings.language).toBe("zh");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toHaveText("Provider settings saved.");
  expect(fixture.updates[0].endpoint).toBe("http://127.0.0.1:8000/v1/audio/transcriptions");
  await expectNoBrowserKey(page);
});

test("cancel, Escape, closing, and navigating clear the password without saving", async ({ page }) => {
  const fixture = await mockProvider(page);
  await openSettings(page);
  await enterKey(page);
  await page.getByRole("button", { name: "Cancel key change", exact: true }).click();
  await expectNoBrowserKey(page);
  await expect(page.locator("#edit-key")).toBeFocused();
  await enterKey(page);
  await page.locator("#api-key").press("Escape");
  await expect(page.locator("#key-editor")).toBeHidden();
  await expectNoBrowserKey(page);
  await page.locator("#provider").selectOption("custom");
  await page.locator("#endpoint").fill("https://speech.example.test/v1/audio/transcriptions");
  await enterKey(page);
  await page.getByRole("button", { name: "Cancel changes", exact: true }).click();
  await expect(page.locator("#provider")).toHaveValue("groq");
  await expect(page.locator("#endpoint-fields")).toBeHidden();
  await expectNoBrowserKey(page);
  for (const event of ["pagehide", "beforeunload"]) {
    await enterKey(page);
    await page.evaluate((name) => window.dispatchEvent(new Event(name)), event);
    await expectNoBrowserKey(page);
  }
  await enterKey(page);
  await page.getByRole("link", { name: "← OpenCode" }).click();
  await page.goBack();
  await expect(page.locator("#provider")).toBeEnabled();
  await expectNoBrowserKey(page);
  expect(fixture.updates).toHaveLength(0);
});

test("write failures stay generic, allow retry, and suppress duplicate submits", async ({ page }) => {
  const fixture = await mockProvider(page);
  fixture.failWrite = true;
  await openSettings(page);
  await enterKey(page);
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#provider-status")).toContainText("Could not save provider settings");
  expect(await page.locator("body").innerText()).not.toContain(secret);
  await expect(page.locator("#api-key")).toHaveValue(secret);
  await expect(page.locator("#provider")).toBeEnabled();
  fixture.failWrite = false;
  let releaseWrite!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  await page.locator("#provider-settings").evaluate((form) => {
    for (let i = 0; i < 3; i++) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  try {
    await expect.poll(() => fixture.updates.length).toBe(2);
    await expect(page.locator("#provider")).toBeDisabled();
    await expect(page.locator("#api-key")).toBeDisabled();
  } finally { releaseWrite(); }
  await expect(page.locator("#provider-status")).toHaveText("Provider settings saved.");
  expect(fixture.updates).toHaveLength(2);
  await expectNoBrowserKey(page);
});

test("read failure is retryable without disabling transcription preferences", async ({ page }) => {
  const fixture = await mockProvider(page);
  fixture.failRead = true;
  await page.goto("/voice/");
  await expect(page.locator("#provider-status")).toContainText("Could not load provider settings");
  await expect(page.locator("#provider")).toBeDisabled();
  await expect(page.locator("#model")).toBeEnabled();
  expect(await page.locator("body").innerText()).not.toContain(secret);
  fixture.failRead = false;
  await page.getByRole("button", { name: "Retry provider settings", exact: true }).click();
  await expect(page.locator("#provider")).toBeEnabled();
  await expect(page.locator("#retry-provider")).toBeHidden();
  await expectNoBrowserKey(page);
});

for (const source of ["legacy", "encrypted"] as const) {
  test(`shows actionable ${source} key status without exposing backend errors`, async ({ page }) => {
    await mockProvider(page, {
      source, apiKeyConfigured: source === "legacy",
      ...(source === "encrypted" ? { error: `Unreadable ${secret}` } : {}),
    });
    await openSettings(page);
    await expect(page.locator("#key-status")).toContainText(source === "legacy" ? "legacy server-file" : "could not read");
    await expect(page.getByRole("button", { name: "Remove key", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Cancel changes", exact: true }).click();
    await expect(page.locator("#key-status")).toContainText(source === "legacy" ? "legacy server-file" : "could not read");
    await expectNoBrowserKey(page);
  });
}

for (const width of [320, 1024]) {
  test(`provider controls stay within the viewport at ${width}px`, async ({ page }) => {
    await mockProvider(page);
    await page.setViewportSize({ width, height: 915 });
    await openSettings(page);
    await page.locator("#provider").selectOption("custom");
    await page.locator("#endpoint").fill(`https://speech.example.test/${"a".repeat(256)}/transcriptions`);
    await enterKey(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    for (const id of ["provider", "endpoint", "api-key", "edit-key", "remove-key"]) {
      const bounds = await page.locator(`#${id}`).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  });
}
