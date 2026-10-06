/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installedRoot } from './security-integrity-installed-root';
import { resolveRoot } from './security-integrity-resolve-root';

// Colocated coverage for single-root override resolution: explicit
// unpacked-tarball overrides win outside CI, empty string counts as
// unset, and CI refuses overrides.

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

describe('security-integrity-resolve-root', () => {
  it('returns an explicit override verbatim outside CI', () => {
    delete process.env.CI;
    expect(resolveRoot('foo', '/tmp/unpack', 'FOO_ROOT')).toBe('/tmp/unpack');
  });

  it('treats an empty-string override as unset', () => {
    delete process.env.CI;
    expect(resolveRoot('vitest', '', 'VITEST_ROOT')).toBe(
      installedRoot('vitest')
    );
  });

  it('refuses overrides under CI', () => {
    process.env.CI = 'true';
    expect(() => resolveRoot('foo', '/tmp/unpack', 'FOO_ROOT')).toThrow(
      /refusing to test a non-installed copy/
    );
  });
});
