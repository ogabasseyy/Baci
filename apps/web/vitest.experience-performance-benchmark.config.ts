import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/experience-performance/benchmark.test.ts'],
    testTimeout: 180000,
    fileParallelism: false,
    passWithNoTests: false,
  },
});
