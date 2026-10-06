/** @vitest-environment node */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  // Dynamically enumerate EVERY installed copy: nested duplicates under
  // the hoisted pnpm layout must not escape the guard silently.
  const roots = new Set<string>();
  const scan = (dir: string, depth: number): void => {
    if (depth > 8) {
      return;
    }
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.name === '@graphql-tools') {
        const candidate = join(full, 'utils');
        if (existsSync(join(candidate, 'package.json'))) {
          roots.add(realpathSync(candidate));
        }
      }
      if (entry.name.startsWith('@')) {
        // Scope dir: children are packages, descend without consuming depth.
        scan(full, depth);
      } else {
        const nested = join(full, 'node_modules');
        if (existsSync(nested)) {
          scan(nested, depth + 1);
        }
      }
    }
  };
  // Scan every node_modules from the test file up to the filesystem
  // root (workspace + repo-root layouts).
  let dir = dirname(fileURLToPath(import.meta.url));
  const seenModules = new Set<string>();
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) {
      const real = realpathSync(candidate);
      if (!seenModules.has(real)) {
        seenModules.add(real);
        scan(real, 0);
      }
    }
    // Stop at the enclosing repo root so worktree checkouts never
    // scan a parent checkout's node_modules.
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return [...roots];
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
