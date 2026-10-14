import {
  chmodSync,
  cpSync,
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
function root() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-public-runtime-'));
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

// True when the vault beside dir holds THIS process's quarantine of
// name. Vault targets embed the quarantining pid, and parallel test
// files run in different workers — pid-scoping keeps vault
// assertions hermetic across the suite (plain suffix matching would
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

describe('non-lab runtime severities and quarantine', () => {
  it.each([
    'originals',
    'c'.repeat(64),
  ])('refuses %s at build, quarantines at runtime, when lab is disabled', (entry) => {
    const dir = root();
    mkdirSync(join(dir, '__pilot', entry), { recursive: true });
    writeFileSync(
      join(dir, '__pilot', entry, 'merchant.avif'),
      'private fixture'
    );
    // Build/deploy severity refuses staged merchant content (no
    // quarantine at build — the deploy never happens).
    expect(() => assertPilotPublicAssets(dir, false, 'throw', 'throw')).toThrow(
      /staged merchant pilot assets/
    );
    expect(existsSync(join(dir, '__pilot', entry, 'merchant.avif'))).toBe(true);
    // Lab mode permits the staged entry once the required filler set
    // is complete; without fillers the grid would render broken
    // images.
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    expect(() => assertPilotPublicAssets(dir, true)).not.toThrow();
    // ... while the default runtime severity moves the entry beside
    // public/ and continues, so a leftover staged tree neither
    // bricks the production boot nor stays served.
    const text = withWarnings(() => {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
    });
    expect(text).toMatch(/staged merchant pilot assets/);
    expect(text).toMatch(
      new RegExp(`moved "${entry}" to .*__pilot-quarantine`)
    );
    expect(existsSync(join(dir, '__pilot', entry))).toBe(false);
    expect(quarantined(dir, entry)).toBe(true);
    // The pinned fillers survive: only the offending entry moves.
    expect(
      existsSync(join(dir, '__pilot', 'fillers', 'grid-filler-600x400-a.png'))
    ).toBe(true);
  });
  it('refuses a staged merchant file hiding under fillers at build, quarantines at runtime', () => {
    const dir = root();
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    writeFileSync(
      join(dir, '__pilot', 'fillers', 'merchant.png'),
      'private fixture'
    );
    expect(() => assertPilotPublicAssets(dir, false, 'throw', 'throw')).toThrow(
      /staged merchant pilot assets/
    );
    const text = withWarnings(() => {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
    });
    expect(text).toMatch(/staged merchant pilot assets/);
    // Per-entry granularity: the whole fillers entry moves (operator
    // restores the committed fixtures from version control).
    expect(existsSync(join(dir, '__pilot', 'fillers'))).toBe(false);
    expect(quarantined(dir, 'fillers')).toBe(true);
  });
  it('refuses a symlinked fillers entry at build, quarantines at runtime', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot'), { recursive: true });
    mkdirSync(join(dir, 'outside'), { recursive: true });
    symlinkSync(join(dir, 'outside'), join(dir, '__pilot', 'fillers'));
    expect(() => assertPilotPublicAssets(dir, false, 'throw', 'throw')).toThrow(
      /not a confined directory/
    );
    const text = withWarnings(() => {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
    });
    expect(text).toMatch(/not a confined directory/);
    expect(existsSync(join(dir, '__pilot', 'fillers'))).toBe(false);
    expect(quarantined(dir, 'fillers')).toBe(true);
    // rename moves the link itself: the vault holds a symlink (still
    // pointing outside) and the target is untouched.
    const link = quarantineTarget(dir, 'fillers');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(dir, 'outside'));
    expect(existsSync(join(dir, 'outside'))).toBe(true);
  });

  it('refuses renamed and nested staging at build, quarantines at runtime', () => {
    // Moving the tree aside does not evade the merchant-shape scan,
    // at any depth or top-level name — at build severity. Runtime
    // boots quarantine the offending top-level entry and continue.
    const names = {
      'junk-dir': 'backup',
      nested: 'originals',
      'top-file': 'merchant.png',
    } as const;
    for (const setup of ['junk-dir', 'top-file', 'nested'] as const) {
      const dir = root();
      if (setup === 'junk-dir') {
        mkdirSync(join(dir, '__pilot', 'backup'), { recursive: true });
        writeFileSync(
          join(dir, '__pilot', 'backup', 'merchant.png'),
          'private fixture'
        );
      } else if (setup === 'top-file') {
        mkdirSync(join(dir, '__pilot'), { recursive: true });
        writeFileSync(join(dir, '__pilot', 'merchant.png'), 'private fixture');
      } else {
        mkdirSync(join(dir, '__pilot', 'originals', 'sub'), {
          recursive: true,
        });
        writeFileSync(
          join(dir, '__pilot', 'originals', 'sub', 'merchant.webp'),
          'private fixture'
        );
      }
      expect(() =>
        assertPilotPublicAssets(dir, false, 'throw', 'throw')
      ).toThrow(/staged merchant pilot assets/);
      const text = withWarnings(() => {
        expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
      });
      expect(text).toMatch(/staged merchant pilot assets/);
      expect(quarantined(dir, names[setup])).toBe(true);
      expect(existsSync(join(dir, '__pilot', names[setup]))).toBe(false);
    }
  });

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

  it('refuses when quarantine fails on a read-only tree', () => {
    // Fail-closed twin of quarantine-and-continue: the entry cannot
    // move, so the bytes would stay served — refuse instead. POSIX
    // only (chmod-based read-only); root-owned runners bypass perms.
    if (process.platform === 'win32') {
      return;
    }
    const dir = root();
    const pilot = join(dir, '__pilot', 'originals');
    mkdirSync(pilot, { recursive: true });
    writeFileSync(join(pilot, 'merchant.avif'), 'private fixture');
    chmodSync(join(dir, '__pilot'), 0o555);
    try {
      expect(() => assertPilotPublicAssets(dir, false)).toThrow(
        /staged merchant pilot assets.*automatic quarantine failed/s
      );
    } finally {
      chmodSync(join(dir, '__pilot'), 0o755);
    }
    // Nothing moved: the tree is intact for the operator.
    expect(existsSync(join(pilot, 'merchant.avif'))).toBe(true);
  });

  it('warns without moving when quarantine is disabled for a foreign tree', () => {
    // The unanchored-candidates shade: a candidate tree may belong to
    // a live lab session elsewhere, so the gate warns and leaves it
    // untouched instead of quarantining.
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'originals'), { recursive: true });
    writeFileSync(
      join(dir, '__pilot', 'originals', 'merchant.avif'),
      'private fixture'
    );
    const text = withWarnings(() => {
      expect(() =>
        assertPilotPublicAssets(dir, false, 'throw', 'warn', false)
      ).not.toThrow();
    });
    expect(text).toMatch(/staged merchant pilot assets/);
    expect(text).toMatch(/without quarantine \(foreign tree\)/);
    expect(existsSync(join(dir, '__pilot', 'originals', 'merchant.avif'))).toBe(
      true
    );
    expect(existsSync(join(dir, '..', '__pilot-quarantine'))).toBe(false);
  });
});
