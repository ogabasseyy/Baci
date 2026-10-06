/** @vitest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageModule } from './security-integrity-package-module';

// Colocated coverage for ESM entry resolution: exports import
// condition first, legacy module field, explicit errors otherwise.

let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'package-module-fixture-'));
  const conditional = join(fixture, 'conditional');
  mkdirSync(conditional, { recursive: true });
  writeFileSync(
    join(conditional, 'package.json'),
    JSON.stringify({
      name: 'conditional',
      exports: {
        '.': { import: './lib/e.mjs', require: './lib/e.cjs' },
      },
    })
  );
  const legacy = join(fixture, 'legacy');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(
    join(legacy, 'package.json'),
    JSON.stringify({ name: 'legacy', module: './lib/e.mjs' })
  );
  const cjsOnly = join(fixture, 'cjs-only');
  mkdirSync(cjsOnly, { recursive: true });
  writeFileSync(
    join(cjsOnly, 'package.json'),
    JSON.stringify({
      name: 'cjs-only',
      exports: { '.': { require: './lib/e.cjs' } },
    })
  );
  const bare = join(fixture, 'bare');
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, 'package.json'), JSON.stringify({ name: 'bare' }));
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('security-integrity-package-module', () => {
  it('prefers the import condition of a conditional export', () => {
    expect(packageModule(join(fixture, 'conditional'))).toBe('./lib/e.mjs');
  });

  it('falls back to the legacy module field', () => {
    expect(packageModule(join(fixture, 'legacy'))).toBe('./lib/e.mjs');
  });

  it('throws an explicit error without an ESM entry', () => {
    expect(() => packageModule(join(fixture, 'cjs-only'))).toThrow(
      /Cannot resolve an ESM entry/
    );
    expect(() => packageModule(join(fixture, 'bare'))).toThrow(
      /Cannot resolve an ESM entry/
    );
  });
});
