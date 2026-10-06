/** @vitest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { versionAt } from './security-integrity-version-at';

// Colocated coverage for manifest version reads: well-formed manifests
// yield their version, manifests without one throw.

let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'version-at-fixture-'));
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
});

describe('security-integrity-version-at', () => {
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
