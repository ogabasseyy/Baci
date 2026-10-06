/** @vitest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCjs, packageMain } from './security-integrity-load';

// Colocated coverage for CJS loading: main-entry resolution with the
// index.js default, plus explicit-subpath loads.

let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'load-fixture-'));
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
  const bare = join(fixture, 'bare');
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, 'package.json'), JSON.stringify({ name: 'bare' }));
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('security-integrity-load', () => {
  it('reads the main entry from the manifest', () => {
    expect(packageMain(join(fixture, 'with-main'))).toBe('./lib/entry.cjs');
  });

  it('defaults to index.js without a main field', () => {
    expect(packageMain(join(fixture, 'bare'))).toBe('index.js');
  });

  it('loads the main entry from a root', () => {
    expect(loadCjs<{ marker: number }>(join(fixture, 'with-main'))).toEqual({
      marker: 42,
    });
  });

  it('loads an explicit subpath', () => {
    expect(
      loadCjs<{ marker: number }>(join(fixture, 'with-main'), 'lib/entry.cjs')
    ).toEqual({ marker: 42 });
  });
});
