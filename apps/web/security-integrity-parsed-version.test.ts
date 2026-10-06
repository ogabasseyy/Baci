/** @vitest-environment node */

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ParsedVersion } from './security-integrity-parsed-version';

// Colocated coverage for the parsed-version shape: a numeric triple
// plus a pre-release flag. The type assertions below are checked at
// compile time; the runtime case pins the shape against silent edits.

describe('security-integrity-parsed-version', () => {
  it('describes a numeric triple plus prerelease flag', () => {
    expectTypeOf<ParsedVersion['triple']>().toEqualTypeOf<
      [number, number, number]
    >();
    expectTypeOf<ParsedVersion['prerelease']>().toEqualTypeOf<boolean>();
    const sample: ParsedVersion = { triple: [1, 2, 3], prerelease: false };
    expect(sample.triple).toEqual([1, 2, 3]);
    expect(sample.prerelease).toBe(false);
  });
});
