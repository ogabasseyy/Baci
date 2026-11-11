/**
 * The test files the `node` Vitest project runs: every plain `.ts` test (no
 * `x`). `.tsx` tests render React components and always run in the `jsdom`
 * project. vitest.config.ts builds both projects from this one pattern, and
 * test/vitest-projects/project-partition.test.ts checks it against the files
 * Vitest really lists.
 */
export const NODE_PROJECT_TEST_GLOB = '**/*.{test,spec}.?(c|m)[jt]s';
