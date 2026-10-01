import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { browserName: 'chromium', channel: 'msedge', baseURL: 'http://127.0.0.1:1431', viewport: { width: 1180, height: 900 } },
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 1431', url: 'http://127.0.0.1:1431', reuseExistingServer: false },
})
