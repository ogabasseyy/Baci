/** @vitest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCjs } from './security-integrity-load-cjs';

// Colocated coverage for CJS loading: manifest-resolved entries plus
// explicit-subpath loads.

let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'load-cjs-fixture-'));
  const withMain = join(fixture, 'with-main');
  mkdirSync(join(withMain, 'lib'), { recursive: true });
  writeFileSync(
    join(withMain, 'package.json'),
    JSON.stringify({ name: 'with-main', main: './lib/entry.cjs' })
  );
  writeFileSync(
    join(withMain, 'lib', 'entry.cjs'),
    'module.exports = { marker: 42 };'
  );
  const exportsString = join(fixture, 'exports-string');
  mkdirSync(join(exportsString, 'lib'), { recursive: true });
  writeFileSync(
    join(exportsString, 'package.json'),
    JSON.stringify({ name: 'exports-string', exports: './lib/entry.cjs' })
  );
  writeFileSync(
    join(exportsString, 'lib', 'entry.cjs'),
    'module.exports = { marker: 7 };'
  );
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('security-integrity-load-cjs', () => {
  it('loads the manifest-resolved entry from a root', () => {
    expect(loadCjs<{ marker: number }>(join(fixture, 'with-main'))).toEqual({
      marker: 42,
    });
    expect(
      loadCjs<{ marker: number }>(join(fixture, 'exports-string'))
    ).toEqual({ marker: 7 });
  });

  it('loads an explicit subpath', () => {
    expect(
      loadCjs<{ marker: number }>(join(fixture, 'with-main'), 'lib/entry.cjs')
    ).toEqual({ marker: 42 });
  });
});
