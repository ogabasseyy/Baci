import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TypeScript from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ts = require('@typescript/typescript6') as typeof TypeScript;
const CATEGORY_PAGE_SHELL_SOURCE = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    'cached-category-page-shell.ts'
  ),
  'utf8'
);
const CATEGORY_PAGE_SHELL_AST = ts.createSourceFile(
  'cached-category-page-shell.ts',
  CATEGORY_PAGE_SHELL_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

function getCategoryPageShellFunctionSource(functionName: string): string {
  let match: TypeScript.FunctionDeclaration | undefined;

  function visit(node: TypeScript.Node): void {
    if (match) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(CATEGORY_PAGE_SHELL_AST);

  if (!match) {
    throw new Error(
      `Unable to locate ${functionName} in cached-category-page-shell.ts`
    );
  }

  return CATEGORY_PAGE_SHELL_SOURCE.slice(
    match.getStart(CATEGORY_PAGE_SHELL_AST),
    match.end
  );
}

describe('cached category page shell cache directives', () => {
  it('keeps the route-critical category page shell off the remote cache handler', () => {
    // The compare page model and compare category inventory were demoted from
    // 'use cache: remote' to local 'use cache' (PR #3049) because their Vercel
    // remote-cache SET (RemoteCacheHandler K.set) hangs and never persists under
    // crawler load. This shell is the LAST route-critical remote write on the
    // compare/category path — it is nested by the category listing page, both
    // compare reads, the price-band page, and the category-scoped semantic
    // inventory — and it is keyed on an unbounded (high-cardinality) category
    // slug. It therefore belongs on the same local cache: no remote write
    // round-trip, and its 'storefront-page' window (revalidate 300) already
    // bounds cross-instance staleness of the rarely-changing shell to ~5min.
    const source = getCategoryPageShellFunctionSource(
      'getCachedCategoryPageShellData'
    );

    expect(source).toContain("'use cache';");
    expect(source).not.toContain("'use cache: remote';");
    expect(source).toContain("cacheLife('storefront-page');");
    expect(source).toContain('cacheTag(');
    expect(source).not.toContain('_storeSlug');
  });
});
