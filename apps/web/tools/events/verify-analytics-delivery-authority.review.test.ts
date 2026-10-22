import { describe, expect, it } from 'vitest';
import { analyzeChangedRuntimeContracts } from './verify-analytics-delivery-authority';

describe('changed analytics runtime review regressions', () => {
  it('does not require a colocated test for a pure runtime barrel', () => {
    const path = 'apps/web/src/lib/analytics/index.ts';
    const sources = new Map([[path, "export { send } from './send';"]]);
    expect(analyzeChangedRuntimeContracts([path], sources)).toEqual([]);
  });

  it.each([
    'fixture.test.ts',
    'fixture.tests.ts',
    'fixture.spec.tsx',
    'fixture.test.mjs',
    'fixture.spec.mjs',
    'fixture.test-suite.ts',
    'fixture.test-support.ts',
    'fixture.test-helpers.ts',
    'fixture.test-fixture.ts',
  ])('exempts %s from changed runtime contracts', (name) => {
    const path = `apps/web/src/lib/analytics/${name}`;
    expect(
      analyzeChangedRuntimeContracts([path], new Map([[path, 'run();']]))
    ).toEqual([]);
  });

  it.each([
    'js',
    'jsx',
    'mjs',
    'cjs',
  ])('enforces changed runtime contracts for .%s sources', (extension) => {
    const path = `apps/web/src/lib/analytics/provider.${extension}`;
    expect(
      analyzeChangedRuntimeContracts(
        [path],
        new Map([[path, 'export const provider = () => true;']])
      )
    ).toEqual([
      `${path}: changed runtime is missing colocated test apps/web/src/lib/analytics/provider.test.${extension}`,
    ]);
  });

  it('does not mistake a .d.js runtime module for a TypeScript declaration', () => {
    const path = 'apps/web/src/lib/analytics/provider.d.js';
    expect(
      analyzeChangedRuntimeContracts(
        [path],
        new Map([[path, 'export const provider = () => true;']])
      )
    ).toEqual([
      `${path}: changed runtime is missing colocated test apps/web/src/lib/analytics/provider.d.test.js`,
    ]);
  });
});
