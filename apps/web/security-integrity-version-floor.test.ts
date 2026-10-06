/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { parseVersion } from './security-integrity-parse-version';
import { isAtLeast } from './security-integrity-version-floor';

// Colocated coverage for version-floor comparison: numeric triples
// with pre-releases ordering below the same triple.

describe('security-integrity-version-floor', () => {
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
