/** @vitest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageMain } from './security-integrity-package-main';

// Colocated coverage for manifest entry resolution: main wins, then the
// exports map ('.' entry, conditions, arrays, top-level sugar), then
// the index.js default, with an explicit error when no CJS entry
// exists.

let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'package-main-fixture-'));
  const withMain = join(fixture, 'with-main');
  mkdirSync(join(withMain, 'lib'), { recursive: true });
  writeFileSync(
    join(withMain, 'package.json'),
    JSON.stringify({ name: 'with-main', main: './lib/entry.cjs' })
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
  const nestedConditions = join(fixture, 'nested-conditions');
  mkdirSync(nestedConditions, { recursive: true });
  writeFileSync(
    join(nestedConditions, 'package.json'),
    JSON.stringify({
      name: 'nested-conditions',
      exports: { '.': { node: { require: './lib/entry.cjs' } } },
    })
  );
  const arrayConditions = join(fixture, 'array-conditions');
  mkdirSync(arrayConditions, { recursive: true });
  writeFileSync(
    join(arrayConditions, 'package.json'),
    JSON.stringify({
      name: 'array-conditions',
      exports: { '.': [{ import: './lib/e.mjs' }, './lib/entry.cjs'] },
    })
  );
  const topSugar = join(fixture, 'top-sugar');
  mkdirSync(topSugar, { recursive: true });
  writeFileSync(
    join(topSugar, 'package.json'),
    JSON.stringify({
      name: 'top-sugar',
      exports: { import: './lib/e.mjs', require: './lib/entry.cjs' },
    })
  );
  const subpathOnly = join(fixture, 'subpath-only');
  mkdirSync(subpathOnly, { recursive: true });
  writeFileSync(
    join(subpathOnly, 'package.json'),
    JSON.stringify({
      name: 'subpath-only',
      exports: { './feature': './lib/feature.cjs' },
    })
  );
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('security-integrity-package-main', () => {
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

  it('resolves one extra nesting level', () => {
    expect(packageMain(join(fixture, 'nested-conditions'))).toBe(
      './lib/entry.cjs'
    );
  });

  it('resolves array-form fallback exports', () => {
    expect(packageMain(join(fixture, 'array-conditions'))).toBe(
      './lib/entry.cjs'
    );
  });

  it('resolves top-level conditional sugar without a dot key', () => {
    expect(packageMain(join(fixture, 'top-sugar'))).toBe('./lib/entry.cjs');
  });

  it('throws for subpath-only exports with no root entry', () => {
    expect(() => packageMain(join(fixture, 'subpath-only'))).toThrow(
      /Cannot resolve a CJS entry/
    );
  });
});
