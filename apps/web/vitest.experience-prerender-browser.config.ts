import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/experience-performance/private-preview-browser.test.ts'],
    testTimeout: 90000,
    fileParallelism: false,
    passWithNoTests: false,
  },
});
