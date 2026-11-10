import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '*qualification.pw.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  retries: 0,
  outputDir:
    '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/playwright-results',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/remaining-browser-results.json',
      },
    ],
  ],
});
