/**
 * Folders (relative to apps/web) whose tests run in the `node` Vitest project:
 * Node's own globals and the slim vitest.setup.node.ts, with no jsdom. Every
 * other test still runs in the `jsdom` project. vitest.config.ts derives both
 * projects from this list, so a file can never run twice or not at all.
 *
 * Only `*.test|spec.{ts,js,mts,mjs,cts,cjs}` files are matched; `.tsx` tests
 * always stay in jsdom. A test in one of these folders that really needs a DOM
 * (`document`, `localStorage`, `DOMParser`, a client-only module...) gets a
 * `// @vitest-environment jsdom` docblock: the node setup then loads the full
 * jsdom setup for that file, so it behaves exactly as it did before.
 *
 * Still in jsdom on purpose: src/components, src/hooks and src/contexts (about
 * 40% of their `.ts` tests need a DOM) and the few root-level `*.test.ts` files.
 *
 * To migrate another folder: add it here, run it with
 * `vitest run --project node <folder>`, and docblock whatever fails loudly.
 * Mind tests that pass but only because a client-only branch is skipped
 * (code reading `window`/`document` through a guard): keep those in jsdom too.
 */
export const NODE_PROJECT_FOLDERS: readonly string[] = [
  'builder-mcp-server',
  'mcp-server',
  'src/ai',
  'src/app',
  'src/config',
  'src/lib',
  'src/schemas',
  'src/scripts',
  'src/services',
  'src/templates',
  'tests',
  'tools',
];
