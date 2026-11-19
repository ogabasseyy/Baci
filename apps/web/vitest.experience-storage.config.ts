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
    include: ['tests/builder-chatgpt/experience-upload.test.ts'],
    testTimeout: 60000,
    passWithNoTests: false,
  },
});
