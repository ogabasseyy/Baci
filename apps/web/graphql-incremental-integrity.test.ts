/** @vitest-environment node */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { packageMain } from './security-integrity-package-main';
import { packageModule } from './security-integrity-package-module';

const require = createRequire(import.meta.url);
const roots = findInstalledRoots('@graphql-tools/utils');
type Merge = (input: {
  incrementalResult: unknown;
  executionResult: Record<string, unknown>;
}) => void;
const marker = 'baciIncrementalPollution';

describe('GraphQL incremental path integrity (GHSA-c4qx-w738-7hr3)', () => {
  it('finds installed consumers', () =>
    expect(roots.length).toBeGreaterThan(0));
  for (const root of roots) {
    for (const format of ['cjs', 'esm'] as const) {
      it(`rejects coerced and inherited paths in ${root} (${format})`, async () => {
        const entry = join(
          root,
          format === 'cjs' ? packageMain(root) : packageModule(root)
        );
        const { mergeIncrementalResult } = (
          format === 'cjs'
            ? require(entry)
            : await import(pathToFileURL(entry).href)
        ) as { mergeIncrementalResult: Merge };
        for (const path of [
          [['__proto__'], marker],
          ['constructor', 'prototype', marker],
          ['__proto__', marker],
          ['toString', marker],
          [marker, ['__proto__']],
          [{ toString: () => '__proto__' }, marker],
        ]) {
          for (const patch of [
            { path, data: { injected: true } },
            { path, items: [{ injected: true }] },
            { incremental: [{ path, data: { injected: true } }] },
          ]) {
            const executionResult = { data: {} };
            try {
              mergeIncrementalResult({
                incrementalResult: patch,
                executionResult,
              });
              expect(Object.hasOwn(Object.prototype, marker)).toBe(false);
              expect(Object.hasOwn(Object.prototype.toString, marker)).toBe(
                false
              );
              expect(Object.getPrototypeOf(executionResult.data)).toBe(
                Object.prototype
              );
            } finally {
              Reflect.deleteProperty(Object.prototype, marker);
              Reflect.deleteProperty(Object.prototype.toString, marker);
            }
          }
        }
      });
      it(`preserves deferred objects and streamed arrays in ${root} (${format})`, async () => {
        const entry = join(
          root,
          format === 'cjs' ? packageMain(root) : packageModule(root)
        );
        const { mergeIncrementalResult } = (
          format === 'cjs'
            ? require(entry)
            : await import(pathToFileURL(entry).href)
        ) as { mergeIncrementalResult: Merge };
        const executionResult: Record<string, unknown> = {
          data: { user: { name: 'Ada' }, items: [] },
        };
        mergeIncrementalResult({
          executionResult,
          incrementalResult: { path: ['user'], data: { active: true } },
        });
        mergeIncrementalResult({
          executionResult,
          incrementalResult: { path: ['items', 0], items: ['a', 'b'] },
        });
        expect(executionResult).toEqual({
          data: { user: { name: 'Ada', active: true }, items: ['a', 'b'] },
        });
      });
    }
  }
});
