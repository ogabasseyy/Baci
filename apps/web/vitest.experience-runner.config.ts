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
      'tools/experience-runner/**/*.test.ts',
      'tests/experience-browser/**/*.test.ts',
    ],
    passWithNoTests: false,
    testTimeout: 10000,
  },
});
