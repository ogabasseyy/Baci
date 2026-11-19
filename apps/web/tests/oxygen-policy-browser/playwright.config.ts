import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'oxygen-policy.pw.ts',
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/baci-oxygen-policy-browser',
  use: { browserName: 'chromium', serviceWorkers: 'block' },
});
