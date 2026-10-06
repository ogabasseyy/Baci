/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findInstalledRoots, overrideRoots } from './security-integrity-scan';

// Regression coverage for CVE-2026-104852 (GHSA-7mx3-vvmw-hjmv):
// `@graphql-tools/utils` `mergeDeep` allowed prototype pollution via
// `__proto__`/`constructor`/`prototype` source keys (`key in output` matches
// inherited members, and the assignment reaches the prototype chain).
// Fixed upstream in 12.0.1; the 12.x line breaks the dependents' ^11
// ranges, so 10.11.0 and 11.1.0 carry backport patches (see
// `pnpm-workspace.yaml` patchedDependencies). This suite drives the
// behavioral exploit through EVERY installed copy, since nested copies
// under graphql-yoga would otherwise escape the guard.
//
// Accepted tradeoff (matches upstream 12.0.1 exactly): source keys named
// `__proto__`/`constructor`/`prototype` are dropped silently at every
// recursion level, so a legitimate own data key with one of those names
// (e.g. a GraphQL field literally called "constructor") no longer
// merges. Dropping is the documented upstream behavior, not a local
// deviation.

const require = createRequire(import.meta.url);

type MergeDeepFn = (sources: unknown[]) => unknown;

function candidateRoots(): string[] {
  // Dynamically enumerate EVERY installed copy: nested duplicates under
  // the hoisted pnpm layout must not escape the guard silently.
  return (
    overrideRoots(process.env.GTU_ROOTS, 'GTU_ROOTS') ??
    findInstalledRoots('@graphql-tools/utils')
  );
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

    // Silent-drop tradeoff is observable: a legitimate own key named
    // "constructor" merges in upstream 10/11 pre-fix builds but is dropped
    // by the backport, matching upstream 12.0.1.
    const dropped = mergeDeep([
      {},
      JSON.parse('{"constructor":{"safe":true}}') as unknown,
    ]) as Record<string, unknown>;
    expect(Object.hasOwn(dropped, 'constructor')).toBe(false);

    // Sanity: ordinary deep merges still work.
    expect(mergeDeep([{ a: { b: 1 } }, { a: { c: 2 } }])).toEqual({
      a: { b: 1, c: 2 },
    });
  });

  it.each(
    candidateRoots()
  )('rejects prototype-chain keys via ESM in %s', async (root) => {
    // The backport patches esm/mergeDeep.js too; drive the exploit
    // through it so a broken or reverted ESM build cannot pass silently.
    const esm = (await import(
      pathToFileURL(join(root, 'esm/mergeDeep.js')).href
    )) as { mergeDeep: MergeDeepFn };
    const merged = esm.mergeDeep([
      { a: 1 },
      JSON.parse('{"__proto__":{"x":1},"b":2}') as unknown,
    ]) as Record<string, unknown>;
    expect(merged).toMatchObject({ a: 1, b: 2 });
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged.x).toBeUndefined();
  });
});
