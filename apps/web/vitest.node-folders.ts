/**
 * Folders (relative to apps/web) whose tests run in the `node` Vitest project:
 * Node's own globals and the slim vitest.setup.node.ts, with no jsdom. Every
 * other test still runs in the `jsdom` project. vitest.config.ts derives both
 * projects from this list, so a file can never run twice or not at all.
 *
 * Only `*.test|spec.{ts,js,mts,mjs,cts,cjs}` files are matched; `.tsx` tests
 * always stay in jsdom. To migrate a folder: add it here, run it with
 * `vitest run --project node <folder>`, and give any test that really needs a
 * DOM a `// @vitest-environment jsdom` docblock (the node setup then loads the
 * full jsdom setup for that file).
 */
export const NODE_PROJECT_FOLDERS: readonly string[] = [
  'src/app/api',
  'tests/vitest-projects',
];
