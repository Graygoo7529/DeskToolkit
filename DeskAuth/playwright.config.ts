import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests', fullyParallel: true, workers: 3,
  use: { browserName: 'chromium', channel: 'msedge', baseURL: 'http://127.0.0.1:1433', viewport: { width: 1220, height: 840 }, screenshot: 'only-on-failure' },
  webServer: { command: 'pnpm dev', url: 'http://127.0.0.1:1433', reuseExistingServer: false },
})
