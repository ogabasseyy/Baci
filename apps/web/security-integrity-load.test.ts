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
  const exportsConditions = join(fixture, 'exports-conditions');
  mkdirSync(join(exportsConditions, 'lib'), { recursive: true });
  writeFileSync(
    join(exportsConditions, 'package.json'),
    JSON.stringify({
      name: 'exports-conditions',
      exports: {
        '.': { import: './lib/entry.mjs', require: './lib/entry.cjs' },
      },
    })
  );
  const esmOnly = join(fixture, 'esm-only');
  mkdirSync(esmOnly, { recursive: true });
  writeFileSync(
    join(esmOnly, 'package.json'),
    JSON.stringify({
      name: 'esm-only',
      exports: { '.': { import: './lib/entry.mjs' } },
    })
  );
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

  it('resolves a string exports entry', () => {
    expect(packageMain(join(fixture, 'exports-string'))).toBe(
      './lib/entry.cjs'
    );
    expect(
      loadCjs<{ marker: number }>(join(fixture, 'exports-string'))
    ).toEqual({ marker: 7 });
  });

  it('prefers the require condition of a conditional export', () => {
    expect(packageMain(join(fixture, 'exports-conditions'))).toBe(
      './lib/entry.cjs'
    );
  });

  it('throws an explicit error for ESM-only exports', () => {
    expect(() => packageMain(join(fixture, 'esm-only'))).toThrow(
      /Cannot resolve a CJS entry/
    );
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
