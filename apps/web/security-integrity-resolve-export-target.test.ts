/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { resolveExportTarget } from './security-integrity-resolve-export-target';

// Colocated coverage for exports-node resolution across shapes and
// condition preferences.

describe('security-integrity-resolve-export-target', () => {
  it('returns plain strings', () => {
    expect(resolveExportTarget('./lib/e.cjs', ['require'])).toBe('./lib/e.cjs');
  });

  it('prefers conditions in order', () => {
    const node = { import: './e.mjs', require: './e.cjs' };
    expect(resolveExportTarget(node, ['require', 'default'])).toBe('./e.cjs');
    expect(resolveExportTarget(node, ['import', 'default'])).toBe('./e.mjs');
  });

  it('resolves nested conditions and arrays', () => {
    expect(
      resolveExportTarget({ node: { require: './e.cjs' } }, ['require', 'node'])
    ).toBe('./e.cjs');
    expect(
      resolveExportTarget([{ import: './e.mjs' }, './e.cjs'], ['require'])
    ).toBe('./e.cjs');
  });

  it('returns null past the nesting cap or without a match', () => {
    expect(
      resolveExportTarget(
        { node: { node: { node: { require: './e.cjs' } } } },
        ['require', 'node']
      )
    ).toBeNull();
    expect(resolveExportTarget({ import: './e.mjs' }, ['require'])).toBeNull();
    expect(resolveExportTarget(null, ['require'])).toBeNull();
    expect(resolveExportTarget(42, ['require'])).toBeNull();
  });
});
