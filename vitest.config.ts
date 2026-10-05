import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      $: fileURLToPath(new URL("./tests/__mocks__/$", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
      exclude: [
        "tests/**",
        "server/**",
        "src/index.ts",
        "playwright.config.ts",
        "src/ui.ts",
        "src/audio.ts",
        "src/types.ts",
        "dist/**",
        "vite.config.ts",
        "vitest.config.ts",
        "vite-env.d.ts",
      ],
    },
  },
});
