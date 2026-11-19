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
    include: ['tests/experience-authoring/**/*.test.ts'],
    testTimeout: 180000,
    hookTimeout: 30000,
    passWithNoTests: false,
    fileParallelism: false,
  },
});
