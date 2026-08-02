import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  workers: 1,
  reporter: [['line']],
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python -m http.server 4173 --directory public',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
