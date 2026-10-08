import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  it.each([
    'originals',
    'c'.repeat(64),
  ])('rejects %s at build/start when lab is disabled', (entry) => {
    const dir = root();
    mkdirSync(join(dir, '__pilot', entry), { recursive: true });
    writeFileSync(
      join(dir, '__pilot', entry, 'merchant.avif'),
      'private fixture'
    );
    expect(() => assertPilotPublicAssets(dir, false)).toThrow(
      /staged merchant pilot assets/
    );
    // Lab mode permits the staged entry once the required filler set is
    // complete; without fillers the grid would render broken images.
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    expect(() => assertPilotPublicAssets(dir, true)).not.toThrow();
  });
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
  it('requires the fillers directory and exact set when lab is enabled', () => {
    const staged = root();
    mkdirSync(join(staged, '__pilot', 'originals'), { recursive: true });
    expect(() => assertPilotPublicAssets(staged, true)).toThrow(
      /missing the fillers directory/
    );
    // A subset of valid fillers still fails: the grid references all
    // three URLs, so a packaging omission must fail startup.
    const partial = root();
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(partial, '__pilot/fillers'),
      { recursive: true }
    );
    rmSync(join(partial, '__pilot/fillers/grid-filler-600x400-b.png'));
    rmSync(join(partial, '__pilot/fillers/grid-filler-600x400-c.png'));
    expect(() => assertPilotPublicAssets(partial, true)).toThrow(
      /missing pinned fillers.*grid-filler-600x400-b\.png/
    );
  });
  it('rejects merchant bytes disguised as a known filler', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot/fillers'), { recursive: true });
    writeFileSync(
      join(dir, '__pilot/fillers/grid-filler-600x400-a.png'),
      'merchant bytes'
    );
    expect(() => assertPilotPublicAssets(dir, false)).toThrow(
      /unapproved filler/
    );
  });
  it('still pins filler hashes when lab is enabled', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot/fillers'), { recursive: true });
    writeFileSync(
      join(dir, '__pilot/fillers/grid-filler-600x400-a.png'),
      'merchant bytes'
    );
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /unapproved filler/
    );
  });
  it('rejects non-generation junk directories even when lab is enabled', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'generation-hash'), { recursive: true });
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /staged merchant pilot assets/
    );
  });
  it('rejects symlinked staging roots', () => {
    const dir = root();
    symlinkSync(root(), join(dir, '__pilot'));
    expect(() => assertPilotPublicAssets(dir, false)).toThrow(
      /unsafe pilot public directory/
    );
  });
});
