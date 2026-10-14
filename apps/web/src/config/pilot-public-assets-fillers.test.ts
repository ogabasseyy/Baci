import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
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

describe('lab filler validation', () => {
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
  it('tolerates stray and partial filler sets when lab is disabled', () => {
    // A packaging artifact (.DS_Store) or a partial set must never
    // take down an unrelated production boot — in either severity.
    // Drifted PINNED bytes are the exception: those refuse (covered
    // in pilot-public-assets.test.ts). Lab mode keeps the exact
    // pinned set.
    const dir = root();
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    writeFileSync(join(dir, '__pilot/fillers/.DS_Store'), 'packaging junk');
    rmSync(join(dir, '__pilot/fillers/grid-filler-600x400-c.png'));
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
      expect(() =>
        assertPilotPublicAssets(dir, false, 'throw', 'throw')
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
    // Strays and partial sets never quarantine in either severity.
    expect(existsSync(join(dir, '__pilot', 'fillers', '.DS_Store'))).toBe(true);
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
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
  it('rejects a symlink swapped in for a filler with the curated error', () => {
    // The pinned read opens no-follow: a link at a pinned name refuses
    // as unapproved instead of hashing the link target's bytes — and
    // the raw ELOOP path leak never surfaces.
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    mkdirSync(join(dir, 'outside'), { recursive: true });
    writeFileSync(join(dir, 'outside', 'secret.png'), 'not yours');
    mkdirSync(join(dir, '__pilot'), { recursive: true });
    mkdirSync(join(dir, 'real-fillers'), { recursive: true });
    symlinkSync(join(dir, 'real-fillers'), fillers);
    // Symlinked fillers dir itself refuses before any content check.
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /unsafe pilot public directory/
    );
    unlinkSync(fillers);
    cpSync(join(process.cwd(), 'public/__pilot/fillers'), fillers, {
      recursive: true,
    });
    rmSync(join(fillers, 'grid-filler-600x400-a.png'));
    symlinkSync(
      join(dir, 'outside', 'secret.png'),
      join(fillers, 'grid-filler-600x400-a.png')
    );
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /unapproved filler/
    );
  });
  it('rejects a FIFO at a pinned filler name without hanging', () => {
    // O_NONBLOCK keeps the open from blocking on the FIFO; fstat then
    // rejects the non-file. mkfifo exists only on POSIX.
    if (process.platform === 'win32') {
      return;
    }
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    cpSync(join(process.cwd(), 'public/__pilot/fillers'), fillers, {
      recursive: true,
    });
    rmSync(join(fillers, 'grid-filler-600x400-a.png'));
    execFileSync('mkfifo', [join(fillers, 'grid-filler-600x400-a.png')]);
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /unapproved filler/
    );
  });
  it('refuses pinned-filler drift at runtime when lab is disabled', () => {
    // The runtime content downgrade never covers drift: a same-tree
    // build already passed these bytes, so drift at boot means
    // post-build tamper — fatal, never quarantined (a tamper signal
    // wants human eyes, not auto-remediation).
    const dir = root();
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    writeFileSync(
      join(dir, '__pilot/fillers/grid-filler-600x400-a.png'),
      'tampered bytes'
    );
    const error = (() => {
      try {
        assertPilotPublicAssets(dir, false);
      } catch (caught) {
        return caught as Error & { code?: string };
      }
      throw new Error('expected drift to refuse');
    })();
    expect(error.message).toMatch(/does not match the pinned hash/);
    expect(error.code).toBe('PILOT_FILLER_DRIFT');
    // Fatal before any move: the tampered bytes stay in place for
    // the operator to inspect.
    expect(
      existsSync(join(dir, '__pilot', 'fillers', 'grid-filler-600x400-a.png'))
    ).toBe(true);
    // Explicit warn drift keeps a probe-style caller booting: the
    // triage warns and nothing throws.
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      expect(() =>
        assertPilotPublicAssets(dir, false, 'warn', 'warn')
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
