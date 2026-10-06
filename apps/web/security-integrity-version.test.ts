/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { isAtLeast, parseVersion } from './security-integrity-version';

// Colocated coverage for version-floor comparison: numeric triples,
// build-metadata tolerance, pre-release ordering, and malformed input.

describe('security-integrity-version', () => {
  it('parses a plain triple', () => {
    expect(parseVersion('1.42.3')).toEqual({
      triple: [1, 42, 3],
      prerelease: false,
    });
  });

  it('ignores build metadata', () => {
    expect(parseVersion('1.9.0+build.7').triple).toEqual([1, 9, 0]);
  });

  it('flags pre-releases', () => {
    expect(parseVersion('1.9.0-beta.1').prerelease).toBe(true);
  });

  it('rejects malformed versions', () => {
    for (const bad of [
      '1.9',
      '1.9.x',
      '',
      'v1.9.0',
      '1.9.0.4',
      '1.9.0foo',
      '1.42.3 ',
      '1..3',
    ]) {
      expect(() => parseVersion(bad)).toThrow(/Unexpected version/);
    }
  });

  it('compares triples numerically', () => {
    expect(isAtLeast(parseVersion('1.42.3'), [1, 42, 3])).toBe(true);
    expect(isAtLeast(parseVersion('1.42.10'), [1, 42, 3])).toBe(true);
    expect(isAtLeast(parseVersion('1.42.2'), [1, 42, 3])).toBe(false);
    expect(isAtLeast(parseVersion('2.0.0'), [1, 99, 99])).toBe(true);
  });

  it('orders pre-releases below the same triple', () => {
    expect(isAtLeast(parseVersion('1.9.0-beta.1'), [1, 9, 0])).toBe(false);
    expect(isAtLeast(parseVersion('1.9.1-beta.1'), [1, 9, 0])).toBe(true);
  });
});
