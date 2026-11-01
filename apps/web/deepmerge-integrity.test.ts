/** @vitest-environment node */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { versionAt } from './security-integrity-version-at';

const require = createRequire(import.meta.url);
const roots = findInstalledRoots('deepmerge').filter((root) =>
  versionAt(root, 'deepmerge').startsWith('4.')
);
type Merge = (
  target: unknown,
  source: unknown,
  options?: Record<string, unknown>
) => Record<string | symbol, unknown>;

describe('deepmerge returned-object prototype integrity (GHSA-gcqx-w48m-w2h4)', () => {
  it('finds affected consumers', () => expect(roots.length).toBeGreaterThan(0));
  for (const root of roots) {
    for (const format of ['dist/cjs.js', 'dist/umd.js']) {
      it(`preserves own data keys without changing the prototype in ${root}/${format}`, () => {
        const merge = require(join(root, format)) as Merge;
        const payload = JSON.parse(
          '{"__proto__":{"injected":true},"safe":1}'
        ) as unknown;
        const nullPrototype = Object.assign(
          Object.create(null),
          payload
        ) as unknown;
        for (const [target, source] of [
          [payload, {}],
          [nullPrototype, {}],
          [Object.create(null), payload],
        ]) {
          const result = merge(target, source);
          expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
          expect(result.injected).toBeUndefined();
          expect(result.safe).toBe(1);
        }
        const symbol = Symbol('metadata');
        expect(
          merge(
            { user: { a: 1 }, list: [1], [symbol]: 'ok' },
            { user: { b: 2 }, list: [2] }
          )
        ).toEqual({ user: { a: 1, b: 2 }, list: [1, 2], [symbol]: 'ok' });
        expect(
          merge(
            { list: [1] },
            { list: [2] },
            { arrayMerge: (_target: unknown, source: unknown) => source }
          )
        ).toEqual({ list: [2] });
      });
    }
  }
});
