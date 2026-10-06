/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { installedRoot } from './security-integrity-installed-root';

// Colocated coverage for installed-root lookup: resolvable packages
// return a directory, missing ones throw (fail closed).

describe('security-integrity-installed-root', () => {
  it('locates an installed package root', () => {
    // vitest runs this suite, so it must resolve.
    expect(installedRoot('vitest')).toMatch(/vitest$/);
  });

  it('throws for a missing package', () => {
    expect(() => installedRoot('no-such-package-xyz')).toThrow();
  });
});
