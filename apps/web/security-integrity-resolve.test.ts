/** @vitest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  installedRoot,
  resolveRoot,
  versionAt,
} from './security-integrity-resolve';

// Colocated coverage for the resolution helpers: missing packages must
// throw (fail closed), CI must refuse tarball overrides, and version
// reads must reject malformed manifests.

let fixture: string;
const savedCI = process.env.CI;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'resolve-fixture-'));
  mkdirSync(join(fixture, 'has-version'), { recursive: true });
  writeFileSync(
    join(fixture, 'has-version', 'package.json'),
    JSON.stringify({ name: 'has-version', version: '1.2.3' })
  );
  mkdirSync(join(fixture, 'no-version'), { recursive: true });
  writeFileSync(
    join(fixture, 'no-version', 'package.json'),
    JSON.stringify({ name: 'no-version' })
  );
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
  if (savedCI === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = savedCI;
  }
});

describe('security-integrity-resolve', () => {
  it('locates an installed package root', () => {
    // vitest runs this suite, so it must resolve.
    const root = installedRoot('vitest');
    expect(versionAt(root, 'vitest')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('throws for a missing package', () => {
    expect(() => installedRoot('no-such-package-xyz')).toThrow();
  });

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
    try {
      expect(() => resolveRoot('foo', '/tmp/unpack', 'FOO_ROOT')).toThrow(
        /refusing to test a non-installed copy/
      );
    } finally {
      delete process.env.CI;
    }
  });

  it('reads the version at a root', () => {
    expect(versionAt(join(fixture, 'has-version'), 'has-version')).toBe(
      '1.2.3'
    );
  });

  it('throws when the manifest has no version', () => {
    expect(() => versionAt(join(fixture, 'no-version'), 'no-version')).toThrow(
      /Cannot read version/
    );
  });
});
