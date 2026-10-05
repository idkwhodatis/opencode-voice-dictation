import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:44097",
    browserName: "chromium",
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "bun run browser-fixture.ts",
    url: "http://127.0.0.1:44097/__test/state",
    reuseExistingServer: false,
  },
});
