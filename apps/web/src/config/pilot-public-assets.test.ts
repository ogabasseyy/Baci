import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPilotPublicAssets } from './pilot-public-assets';

const roots: string[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-public-guard-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('non-lab public assets gate', () => {
  it('permits absent staging and verified committed fillers', () => {
    const dir = root();
    expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
    // Lab mode requires the tree itself: an absent root must fail
    // startup, or deleting the whole directory bypasses the filler
    // requirement.
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /missing the pilot root directory/
    );
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
  });
  // Build-vs-runtime severity splits, drift, and quarantine live in
  // the sibling pilot-public-assets-runtime.test.ts suite (line
  // ceiling); this file keeps the shape triage (lab, strays, empty).
  it.each([
    'originals',
    'c'.repeat(64),
  ])('rejects a symlinked %s entry even when lab is enabled', (entry) => {
    const dir = root();
    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'not yours');
    mkdirSync(join(dir, '__pilot'), { recursive: true });
    symlinkSync(outside, join(dir, '__pilot', entry));
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /not a confined directory/
    );
  });
  it('rejects symlinks nested inside managed entries', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'originals', 'nested'), { recursive: true });
    symlinkSync('/etc', join(dir, '__pilot', 'originals', 'nested', 'evil'));
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /contains a symlink/
    );
  });
  it('warns on stray files but boots when lab is disabled', () => {
    // Strays warn in every mode: OS artifacts and renamed leftovers
    // warn instead of bricking the production build/boot.
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'originals'), { recursive: true });
    writeFileSync(join(dir, '__pilot', 'originals', '.DS_Store'), 'junk');
    writeFileSync(join(dir, '__pilot', '.DS_Store'), 'junk');
    const warnings: unknown[][] = [];
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((...args: unknown[]) => {
        warnings.push(args);
      });
    try {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
    expect(warnings.join('\n')).toMatch(/stray file\(s\) under "originals"/);
    expect(warnings.join('\n')).toMatch(/stray file ".DS_Store"/);
    // Strays warn without quarantine: only staged-merchant and
    // confinement findings move.
    expect(existsSync(join(dir, '__pilot', '.DS_Store'))).toBe(true);
    expect(existsSync(join(dir, '__pilot', 'originals', '.DS_Store'))).toBe(
      true
    );
  });

  it('passes empty leftover dirs silently when lab is disabled', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'originals'), { recursive: true });
    mkdirSync(join(dir, '__pilot', 'c'.repeat(64)), { recursive: true });
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
    expect(existsSync(join(dir, '__pilot', 'originals'))).toBe(true);
  });
});
