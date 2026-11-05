import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", fullyParallel: true, workers: 2,
  use: { browserName: "chromium", channel: "msedge", baseURL: "http://127.0.0.1:1442", viewport: { width: 1260, height: 820 }, screenshot: "only-on-failure" },
  webServer: { command: "pnpm dev --host 127.0.0.1", url: "http://127.0.0.1:1442", reuseExistingServer: !process.env.CI },
});

