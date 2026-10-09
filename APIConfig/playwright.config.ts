import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 4,
  use: { browserName: 'chromium', channel: 'msedge', baseURL: 'http://127.0.0.1:1431', viewport: { width: 1180, height: 800 } },
  webServer: { command: 'pnpm dev --configLoader runner --host 127.0.0.1 --port 1431', url: 'http://127.0.0.1:1431', reuseExistingServer: false },
})
