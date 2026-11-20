import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: { '@/': new URL('./src/', import.meta.url).pathname },
  },
  test: {
    environment: 'node',
    include: [
      'tests/experience-performance/private-preview-browser.test.ts',
      'tests/experience-performance/delivery-sandbox-browser.test.ts',
    ],
    testTimeout: 90000,
    fileParallelism: false,
    passWithNoTests: false,
  },
});
