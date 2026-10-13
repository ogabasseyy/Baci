/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { parseVersion } from './security-integrity-parse-version';

// Colocated coverage for version parsing: numeric triples,
// build-metadata tolerance, pre-release flags, and malformed input.

describe('security-integrity-parse-version', () => {
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
});
