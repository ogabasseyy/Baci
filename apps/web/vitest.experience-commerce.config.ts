import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@/': new URL('./src/', import.meta.url).pathname } },
  test: {
    environment: 'node',
    include: ['tests/experience-commerce/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    passWithNoTests: false,
  },
});
