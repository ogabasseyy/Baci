import { execFileSync } from 'node:child_process';
import {
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPilotPublicAssets,
  resolvePilotPublicDir,
  resolveRoutePublicDir,
} from './pilot-public-assets';

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
  it('rejects a file hardlinked from outside the managed entry', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'originals'), { recursive: true });
    const outside = join(dir, 'outside-secret.txt');
    writeFileSync(outside, 'not yours');
    // Same inode, two names: realpath cannot expose the outside
    // original, so only the link-count gate refuses to serve it.
    linkSync(outside, join(dir, '__pilot', 'originals', 'merchant.avif'));
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(/hardlinked file/);
  });
  it('rejects a FIFO planted inside a managed entry', () => {
    // A single-linked FIFO passes the symlink and hardlink gates; Next
    // would then block serving it. mkfifo exists only on POSIX.
    if (process.platform === 'win32') {
      return;
    }
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'originals'), { recursive: true });
    execFileSync('mkfifo', [
      join(dir, '__pilot', 'originals', 'merchant.avif'),
    ]);
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(/special file/);
  });
  it('requires the exact filler set in non-lab trees too', () => {
    const dir = root();
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    rmSync(join(dir, '__pilot/fillers/grid-filler-600x400-c.png'));
    expect(() => assertPilotPublicAssets(dir, false)).toThrow(
      /non-lab public pilot tree is missing pinned fillers.*grid-filler-600x400-c\.png/
    );
  });
});

describe('resolvePilotPublicDir', () => {
  const argv1 = process.argv[1];
  afterEach(() => {
    process.argv[1] = argv1;
    vi.unstubAllEnvs();
  });
  it('prefers the config-stashed root', () => {
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/app/public');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '{}');
    expect(resolvePilotPublicDir()).toBe('/app/public');
  });
  it('anchors standalone boots to the server script, not cwd', () => {
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '{}');
    process.argv[1] = '/srv/standalone/apps/web/server.js';
    expect(resolvePilotPublicDir()).toBe('/srv/standalone/apps/web/public');
  });
  it('falls back to cwd otherwise', () => {
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
    expect(resolvePilotPublicDir()).toBe(join(process.cwd(), 'public'));
  });
});

describe('resolveRoutePublicDir', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('prefers the explicit route var, then the gate stash, then cwd', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '/route/public');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/route/public');
    expect(resolveRoutePublicDir()).toBe('/route/public');
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '');
    expect(resolveRoutePublicDir()).toBe('/route/public');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    expect(resolveRoutePublicDir()).toBe(join(process.cwd(), 'public'));
  });
  it('fails closed when the two roots disagree', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '/route/public');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/gate/public');
    expect(() => resolveRoutePublicDir()).toThrow(/disagrees/);
  });
  it('accepts symlinked-ancestor aliases of the same tree', () => {
    // The route var may spell the tree through a symlinked ancestor
    // (/var/... on macOS) while the gate stashed the physical path:
    // distinct spellings of one directory must not read as disagreement.
    const physical = mkdtempSync(join(tmpdir(), 'pilot-public-alias-'));
    const logical = `${physical}-link`;
    symlinkSync(physical, logical);
    try {
      vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', logical);
      vi.stubEnv('BACI_PILOT_PUBLIC_DIR', realpathSync(physical));
      expect(resolveRoutePublicDir()).toBe(logical);
    } finally {
      rmSync(logical, { force: true, recursive: true });
      rmSync(physical, { force: true, recursive: true });
    }
  });
});
