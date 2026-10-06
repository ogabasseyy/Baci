/** @vitest-environment node */

import { realpathSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { installedRoot } from './security-integrity-installed-root';

// Colocated coverage for installed-root lookup: resolvable packages
// return a directory, missing ones throw (fail closed).

describe('security-integrity-installed-root', () => {
  it('locates an installed package root', () => {
    // vitest runs this suite, so it must resolve.
    const root = installedRoot('vitest');
    expect(root).toMatch(/vitest$/);
    // Canonicalized like the scanner's roots: idempotent under realpath.
    expect(root).toBe(realpathSync(root));
  });

  it('resolves relative to an explicit start dir', () => {
    const root = installedRoot('vitest');
    expect(installedRoot('vitest', root)).toBe(root);
    expect(() => installedRoot('no-such-package-xyz', root)).toThrow();
  });

  it('throws for a missing package', () => {
    expect(() => installedRoot('no-such-package-xyz')).toThrow();
  });
});
