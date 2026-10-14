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
  it.each([
    'originals',
    'c'.repeat(64),
  ])('refuses %s at build, warns at runtime, when lab is disabled', (entry) => {
    const dir = root();
    mkdirSync(join(dir, '__pilot', entry), { recursive: true });
    writeFileSync(
      join(dir, '__pilot', entry, 'merchant.avif'),
      'private fixture'
    );
    // Build/deploy severity refuses staged merchant content ...
    expect(() => assertPilotPublicAssets(dir, false, 'throw', 'throw')).toThrow(
      /staged merchant pilot assets/
    );
    // ... while the default runtime severity warns and continues, so
    // a leftover staged tree never bricks the production boot.
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
    expect(warnings.join('\n')).toMatch(/staged merchant pilot assets/);
    expect(warnings.join('\n')).toMatch(/runtime only warns/);
    // Lab mode permits the staged entry once the required filler set is
    // complete; without fillers the grid would render broken images.
    cpSync(
      join(process.cwd(), 'public/__pilot/fillers'),
      join(dir, '__pilot/fillers'),
      { recursive: true }
    );
    expect(() => assertPilotPublicAssets(dir, true)).not.toThrow();
  });
  it('refuses a staged merchant file hiding under fillers at build, warns at runtime', () => {
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
    expect(warnings.join('\n')).toMatch(/staged merchant pilot assets/);
  });
  it('refuses a symlinked fillers entry at build, warns at runtime', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot'), { recursive: true });
    mkdirSync(join(dir, 'outside'), { recursive: true });
    symlinkSync(join(dir, 'outside'), join(dir, '__pilot', 'fillers'));
    expect(() => assertPilotPublicAssets(dir, false, 'throw', 'throw')).toThrow(
      /not a confined directory/
    );
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
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
  });

  it('refuses renamed and nested staging at build, warns at runtime', () => {
    // Moving the tree aside does not evade the merchant-shape scan,
    // at any depth or top-level name — at build severity. Runtime
    // boots warn and continue.
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
      expect(warnings.join('\n')).toMatch(/staged merchant pilot assets/);
    }
  });

  it('refuses symlink escapes at build, warns at runtime', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot'), { recursive: true });
    symlinkSync(join(dir, 'outside.txt'), join(dir, '__pilot', 'evil'));
    writeFileSync(join(dir, 'outside.txt'), 'not yours');
    expect(() => assertPilotPublicAssets(dir, false, 'throw', 'throw')).toThrow(
      /is a symlink/
    );
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
    expect(warnings.join('\n')).toMatch(/is a symlink/);
  });

  it('refuses staged merchant trees at build, warns at runtime', () => {
    // The filler tolerance above must not weaken the actual non-lab
    // safety goal: generation/originals staging refuses at build and
    // warns loudly at runtime.
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
    expect(warnings.join('\n')).toMatch(/staged merchant pilot assets/);
  });

  it('refuses pinned-filler drift at runtime when lab is disabled', () => {
    // The runtime content downgrade above never covers drift: a
    // same-tree build already passed these bytes, so drift at boot
    // means post-build tamper and refuses past the warn downgrade.
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
