import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: {
      '@/': new URL('./src/', import.meta.url).pathname,
      '@baci/shared/experience': new URL(
        '../../packages/shared/src/experience/index.ts',
        import.meta.url
      ).pathname,
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/experience-performance/prepare-prototype.test.ts',
      'tests/experience-performance/prerender-document.test.ts',
      'tests/experience-performance/bounded-input.test.ts',
      'tests/experience-performance/lab-observers.test.ts',
    ],
    testTimeout: 180000,
    hookTimeout: 30000,
    fileParallelism: false,
    passWithNoTests: false,
  },
});
