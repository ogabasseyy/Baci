/** @vitest-environment node */

import { delimiter } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overrideRoots } from './security-integrity-override-roots';

// Colocated coverage for multi-root overrides: unset/empty yields null
// (caller falls back to the workspace scan), delimiter-joined lists
// split, and CI refuses overrides.

describe('security-integrity-override-roots', () => {
  it('returns null when unset or empty', () => {
    expect(overrideRoots(undefined, 'GTU_ROOTS')).toBeNull();
    expect(overrideRoots('', 'GTU_ROOTS')).toBeNull();
  });

  it('splits on the platform path delimiter', () => {
    const joined = ['/a', '/b'].join(delimiter);
    expect(overrideRoots(joined, 'GTU_ROOTS')).toEqual(['/a', '/b']);
  });

  it('refuses overrides under CI', () => {
    const savedCI = process.env.CI;
    process.env.CI = 'true';
    try {
      expect(() => overrideRoots('/a', 'GTU_ROOTS')).toThrow(
        /refusing to test non-installed copies/
      );
    } finally {
      // Restore, never blank: the runner normally has CI set, and
      // clearing it would weaken later CI-refusal assertions in this
      // worker.
      if (savedCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = savedCI;
      }
    }
  });
});
