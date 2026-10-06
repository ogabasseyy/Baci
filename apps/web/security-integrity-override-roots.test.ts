/** @vitest-environment node */

import { delimiter } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { overrideRoots } from './security-integrity-override-roots';

// Colocated coverage for multi-root overrides: unset/empty yields null
// (caller falls back to the workspace scan), delimiter-joined lists
// split, and CI refuses overrides.

let savedCI: string | undefined;

beforeEach(() => {
  savedCI = process.env.CI;
});

afterEach(() => {
  // Restore per test, never blank: the runner normally has CI set, and
  // leaking a cleared value would weaken later CI-refusal assertions.
  if (savedCI === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = savedCI;
  }
});

describe('security-integrity-override-roots', () => {
  it('returns null when unset or empty', () => {
    expect(overrideRoots(undefined, 'GTU_ROOTS')).toBeNull();
    expect(overrideRoots('', 'GTU_ROOTS')).toBeNull();
  });

  it('splits on the platform path delimiter', () => {
    // Non-empty overrides are refused under CI by design, so this
    // split-behavior case opts out of CI (restored by afterEach).
    delete process.env.CI;
    const joined = ['/a', '/b'].join(delimiter);
    expect(overrideRoots(joined, 'GTU_ROOTS')).toEqual(['/a', '/b']);
  });

  it('refuses overrides under CI', () => {
    process.env.CI = 'true';
    expect(() => overrideRoots('/a', 'GTU_ROOTS')).toThrow(
      /refusing to test non-installed copies/
    );
  });
});
