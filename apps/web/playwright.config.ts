import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const configuredPort = process.env.CHECKOUT_BROWSER_PORT?.trim();
const port = Number(configuredPort || 3217);
const firefoxHome = fs.mkdtempSync(
  path.join(os.tmpdir(), 'baci-playwright-firefox-home-')
);
process.on('exit', () =>
  fs.rmSync(firefoxHome, { recursive: true, force: true })
);

export default defineConfig({
  testDir: './tests/checkout-browser',
  testMatch: '**/*.pw.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  outputDir:
    process.env.CHECKOUT_BROWSER_ARTIFACTS ||
    path.join(os.tmpdir(), 'baci-checkout-browser'),
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    ...(['chromium', 'webkit'] as const).map((browserName) => ({
      name: browserName,
      use: { browserName },
    })),
    {
      name: 'firefox-chat-drag',
      testMatch: '**/storefront-chat-overlay.pw.ts',
      use: {
        browserName: 'firefox',
        launchOptions: {
          env: { ...process.env, HOME: firefoxHome },
        },
      },
    },
  ],
  webServer: {
    command: `pnpm exec next start tests/checkout-browser/harness --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/catalog`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
