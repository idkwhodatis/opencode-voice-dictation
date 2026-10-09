import { defineConfig } from "@playwright/test";

const bases = ["/", "/opencode/", "/apps/ai/opencode/"];
const modes = ["preserve", "strip"] as const;

export default defineConfig({
  testDir: ".",
  testMatch: "namespace.spec.ts",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  projects: bases.flatMap((basePath, baseIndex) =>
    modes.map((proxyMode, modeIndex) => ({
      name: `${basePath}:${proxyMode}`,
      metadata: { basePath, proxyMode },
      use: { baseURL: `http://127.0.0.1:${44110 + baseIndex * 2 + modeIndex}` },
    })),
  ),
  use: {
    browserName: "chromium",
    serviceWorkers: "allow",
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `${process.env.BUN_PATH ?? "bun"} run namespace-fixture.ts`,
    url: "http://127.0.0.1:44110/__namespace/state",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
