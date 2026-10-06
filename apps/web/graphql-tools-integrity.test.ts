/** @vitest-environment node */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression coverage for CVE-2026-104852 (GHSA-7mx3-vvmw-hjmv):
// `@graphql-tools/utils` `mergeDeep` allowed prototype pollution via
// `__proto__`/`constructor`/`prototype` source keys (`key in output` matches
// inherited members, and the assignment reaches the prototype chain).
// Fixed upstream in 12.0.1; the 12.x line breaks the dependents' ^11
// ranges, so 10.11.0 and 11.1.0 carry backport patches (see
// `pnpm-workspace.yaml` patchedDependencies). This suite drives the
// behavioral exploit through EVERY installed copy, since nested copies
// under graphql-yoga would otherwise escape the guard.

const require = createRequire(import.meta.url);

type MergeDeepFn = (sources: unknown[]) => unknown;

function candidateRoots(): string[] {
  const override = process.env.GTU_ROOTS;
  if (override !== undefined) {
    // Verification hook only: colon-separated unpacked
    // @graphql-tools/utils tarballs to confirm this test fails on
    // pre-fix releases. Refused under CI so a green run always guards
    // the workspace-resolved dependencies.
    if (process.env.CI !== undefined) {
      throw new Error(
        'GTU_ROOTS is set in CI; refusing to test non-installed copies'
      );
    }
    console.warn(`[integrity-test] testing graphql-tools from: ${override}`);
    return override.split(':').filter((root) => root.length > 0);
  }
  const roots: string[] = [];
  const pushIfDir = (root: string) => {
    if (existsSync(join(root, 'package.json'))) {
      roots.push(root);
    }
  };
  pushIfDir(dirname(require.resolve('@graphql-tools/utils/package.json')));
  const nm = join(dirname(require.resolve('graphql/package.json')), '..');
  pushIfDir(join(nm, 'graphql-yoga/node_modules/@graphql-tools/utils'));
  pushIfDir(
    join(
      nm,
      '@graphql-yoga/plugin-defer-stream/node_modules/@graphql-tools/utils'
    )
  );
  return [...new Set(roots)];
}

function loadMergeDeep(root: string): {
  version: string;
  mergeDeep: MergeDeepFn;
} {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: string;
    main?: string;
  };
  const entry = require(join(root, pkg.main ?? 'cjs/index.js')) as {
    mergeDeep: MergeDeepFn;
  };
  return { version: pkg.version ?? 'unknown', mergeDeep: entry.mergeDeep };
}

describe('@graphql-tools/utils mergeDeep integrity (CVE-2026-104852)', () => {
  it('finds at least one installed copy to guard', () => {
    expect(candidateRoots().length).toBeGreaterThan(0);
  });

  it.each(candidateRoots())('rejects prototype-chain keys in %s', (root) => {
    const { version, mergeDeep } = loadMergeDeep(root);
    expect(typeof version).toBe('string');

    // __proto__ payload must not swap the result's prototype.
    const merged = mergeDeep([
      { a: 1 },
      JSON.parse('{"__proto__":{"x":1},"b":2}') as unknown,
    ]) as Record<string, unknown>;
    expect(merged).toMatchObject({ a: 1, b: 2 });
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged.x).toBeUndefined();

    // constructor.prototype payload must neither throw nor pollute.
    expect(() =>
      mergeDeep([
        {},
        JSON.parse('{"constructor":{"prototype":{"y":2}}}') as unknown,
      ])
    ).not.toThrow();
    expect(({} as Record<string, unknown>).y).toBeUndefined();

    // Sanity: ordinary deep merges still work.
    expect(mergeDeep([{ a: { b: 1 } }, { a: { c: 2 } }])).toEqual({
      a: { b: 1, c: 2 },
    });
  });
});
