import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPilotPublicAssets } from './pilot-public-assets';

const roots: string[] = [];
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-public-quarantine-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
  // Quarantine vaults live beside the sandbox public dirs (all share
  // the tmp parent): clear them so vault assertions stay hermetic.
  rmSync(join(tmpdir(), '__pilot-quarantine'), {
    recursive: true,
    force: true,
  });
});

// Quarantine vault entries are timestamped `${name}-${pid}-...`: match
// this process's quarantine of the entry (parallel workers must not
// see other files' quarantines of same-named entries).
function quarantined(dir: string, name: string): boolean {
  const mine = `-${process.pid}-${name}`;
  try {
    return readdirSync(join(dir, '..', '__pilot-quarantine')).some((entry) =>
      entry.endsWith(mine)
    );
  } catch {
    return false;
  }
}

function quarantineTarget(dir: string, name: string): string {
  const vault = join(dir, '..', '__pilot-quarantine');
  const mine = `-${process.pid}-${name}`;
  const hit = readdirSync(vault).find((entry) => entry.endsWith(mine));
  if (!hit) throw new Error(`no quarantine of ${name} in ${vault}`);
  return join(vault, hit);
}

function withWarnings(run: () => void): string {
  const warnings: unknown[][] = [];
  const warnSpy = vi
    .spyOn(console, 'warn')
    .mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
  try {
    run();
  } finally {
    warnSpy.mockRestore();
  }
  return warnings.join('\n');
}

describe('runtime quarantine-and-continue', () => {
  it('refuses symlink escapes at build, quarantines at runtime', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot'), { recursive: true });
    symlinkSync(join(dir, 'outside.txt'), join(dir, '__pilot', 'evil'));
    writeFileSync(join(dir, 'outside.txt'), 'not yours');
    expect(() => assertPilotPublicAssets(dir, false, 'throw', 'throw')).toThrow(
      /is a symlink/
    );
    const text = withWarnings(() => {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
    });
    expect(text).toMatch(/is a symlink/);
    expect(quarantined(dir, 'evil')).toBe(true);
    // The quarantined entry is the link itself, un-traversed: moving
    // it must not resolve or copy the outside target into the vault.
    const target = quarantineTarget(dir, 'evil');
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe(join(dir, 'outside.txt'));
    expect(existsSync(join(dir, '__pilot', 'evil'))).toBe(false);
    // The link target is outside the tree: quarantining the link
    // leaves it alone.
    expect(existsSync(join(dir, 'outside.txt'))).toBe(true);
  });

  it('refuses staged merchant trees at build, quarantines at runtime', () => {
    // The filler tolerance must not weaken the non-lab safety goal:
    // generation/originals staging refuses at build and quarantines
    // at runtime, while the stray-only fillers dir stays put.
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'originals'), { recursive: true });
    writeFileSync(
      join(dir, '__pilot', 'originals', 'merchant.avif'),
      'private fixture'
    );
    mkdirSync(join(dir, '__pilot', 'fillers'), { recursive: true });
    writeFileSync(join(dir, '__pilot', 'fillers', '.DS_Store'), 'junk');
    expect(() => assertPilotPublicAssets(dir, false, 'throw', 'throw')).toThrow(
      /staged merchant pilot assets/
    );
    const text = withWarnings(() => {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
    });
    expect(text).toMatch(/staged merchant pilot assets/);
    expect(quarantined(dir, 'originals')).toBe(true);
    expect(existsSync(join(dir, '__pilot', 'originals'))).toBe(false);
    expect(existsSync(join(dir, '__pilot', 'fillers', '.DS_Store'))).toBe(true);
    expect(quarantined(dir, 'fillers')).toBe(false);
  });

  it('continues when a concurrent boot quarantines first', () => {
    // Two instances booting against the same tree can both observe one
    // offending entry; the loser's rename hits ENOENT on the moved
    // source. The bytes are unserved either way, so the boot warns
    // and continues instead of bricking a healthy instance. The
    // injected rename replays the loser's kernel view exactly: the
    // source is gone (the winner moved it) and the rename raises.
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'originals'), { recursive: true });
    writeFileSync(
      join(dir, '__pilot', 'originals', 'merchant.avif'),
      'private fixture'
    );
    const text = withWarnings(() => {
      expect(() =>
        assertPilotPublicAssets(dir, false, 'throw', 'warn', true, {
          renameEntry: (source: string) => {
            rmSync(source, { force: true, recursive: true });
            const error = new Error(
              `ENOENT: no such file or directory, rename '${source}'`
            ) as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            throw error;
          },
        })
      ).not.toThrow();
    });
    expect(text).toMatch(/already quarantined by a concurrent boot/);
    expect(existsSync(join(dir, '__pilot', 'originals'))).toBe(false);
  });
});
