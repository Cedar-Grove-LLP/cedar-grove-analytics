import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.mjs/,
    },
    {
      name: 'chromium-admin',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        storageState: '.auth/admin.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-attorney',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        storageState: '.auth/attorney.json',
      },
      dependencies: ['setup'],
    },
    {
      // Request-level API route tests (no browser, no storageState — tokens
      // are minted directly from the Auth emulator REST API). Depends on
      // 'setup' so it runs against the same fully-booted emulator + server.
      name: 'api',
      testDir: 'tests/api',
      testMatch: /.*\.api\.spec\.mjs/,
      dependencies: ['setup'],
    },
    {
      name: 'chromium-partial',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        storageState: '.auth/partial.json',
      },
      dependencies: ['setup'],
    },
  ],
});
