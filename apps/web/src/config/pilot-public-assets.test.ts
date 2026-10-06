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
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
  });
  it.each([
    'originals',
    'generation-hash',
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
    expect(() => assertPilotPublicAssets(dir, true)).not.toThrow();
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
  it('rejects symlinked staging roots', () => {
    const dir = root();
    symlinkSync(root(), join(dir, '__pilot'));
    expect(() => assertPilotPublicAssets(dir, false)).toThrow(
      /unsafe pilot public directory/
    );
  });
});
