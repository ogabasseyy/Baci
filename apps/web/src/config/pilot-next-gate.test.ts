import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPilotPublicGate, classifyGatePhase } from './pilot-next-gate';

const NEXT_BIN = '/repo/node_modules/next/dist/bin/next';
const BUILD_ARGV = ['node', NEXT_BIN, 'build', '/repo/apps/web'];
const START_ARGV = ['node', NEXT_BIN, 'start'];
const DEV_ARGV = ['node', NEXT_BIN, 'dev'];
const TOOLING_ARGV = ['node', '/repo/node_modules/vitest/vitest.mjs', 'run'];

describe('classifyGatePhase', () => {
  it.each([
    ['build', BUILD_ARGV, 'build'],
    ['start', START_ARGV, 'start'],
    ['dev', DEV_ARGV, 'dev'],
    ['dev with flags', ['node', NEXT_BIN, 'dev', '--turbo'], 'dev'],
    [
      'pnpm shim path',
      ['node', '/repo/node_modules/.pnpm/next@16/bin/next', 'build'],
      'build',
    ],
    ['windows backslashes', ['node', 'C:\\repo\\bin\\next', 'start'], 'start'],
    ['windows exe', ['node', 'C:\\repo\\bin\\next.exe', 'dev'], 'dev'],
    ['bare next without subcommand', ['node', NEXT_BIN], 'other'],
    [
      'experimental subcommand',
      ['node', NEXT_BIN, 'experimental-test'],
      'other',
    ],
    ['next-server standalone entry', ['node', '/app/server.js'], 'other'],
    ['vitest worker', TOOLING_ARGV, 'other'],
    [
      'tsx CLI',
      ['node', '/repo/node_modules/tsx/dist/cli.mjs', 'x.ts'],
      'other',
    ],
    ['empty argv', [], 'other'],
  ])('%s classifies as %s', (_name, argv, phase) => {
    expect(classifyGatePhase(argv)).toBe(phase);
  });
});

describe('applyPilotPublicGate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.BACI_PILOT_PUBLIC_DIR;
  });

  it('stashes the config-anchored public dir for the dev/start boot gate', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    for (const argv of [DEV_ARGV, START_ARGV]) {
      delete process.env.BACI_PILOT_PUBLIC_DIR;
      const publicDir = applyPilotPublicGate(configDir, argv);
      expect(publicDir).toBe(join(configDir, 'public'));
      expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe(join(configDir, 'public'));
    }
  });

  it('refuses staged data at build in non-lab mode like the inline gate', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    mkdirSync(join(configDir, 'public', '__pilot', 'originals'), {
      recursive: true,
    });
    writeFileSync(
      join(configDir, 'public', '__pilot', 'originals', 'staged.png'),
      'staged'
    );
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    expect(() => applyPilotPublicGate(configDir, BUILD_ARGV)).toThrow(
      /staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1/
    );
    // The build refuses without mutating: quarantine is runtime-only.
    expect(
      existsSync(
        join(configDir, 'public', '__pilot', 'originals', 'staged.png')
      )
    ).toBe(true);
    // ... and without stashing: the value would die with the build
    // process anyway, and a same-process stash leaks into spawned
    // child tooling that later resolves it.
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBeUndefined();
  });

  it('does not assert at dev/start: runtime boots own enforcement', () => {
    // A leftover staged tree must not fail a dev server or a start:
    // instrumentation verifies (lab, fatal) or quarantines and
    // continues (non-lab content) once booted.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    mkdirSync(join(configDir, 'public', '__pilot', 'originals'), {
      recursive: true,
    });
    writeFileSync(
      join(configDir, 'public', '__pilot', 'originals', 'staged.png'),
      'staged'
    );
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    for (const argv of [DEV_ARGV, START_ARGV]) {
      expect(() => applyPilotPublicGate(configDir, argv)).not.toThrow();
    }
  });

  it('is a no-op for unrelated config evaluation', () => {
    // Typegen, tests, and tooling import next.config without booting
    // or serving: no assert, no stash, and even a disagreeing preset
    // is ignored (it only constrains boots).
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    mkdirSync(join(configDir, 'public', '__pilot', 'originals'), {
      recursive: true,
    });
    writeFileSync(
      join(configDir, 'public', '__pilot', 'originals', 'staged.png'),
      'staged'
    );
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/operator/tree/public');
    const publicDir = applyPilotPublicGate(configDir, TOOLING_ARGV);
    expect(publicDir).toBe(join(configDir, 'public'));
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe('/operator/tree/public');
  });

  it('refuses a merchant image renamed to a pinned filler name at build', () => {
    // Strict build-gate drift: warn-only at runtime would let a
    // renamed merchant png ship silently, so the build fails it.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    const fillers = join(configDir, 'public', '__pilot', 'fillers');
    mkdirSync(join(configDir, 'public', '__pilot', 'originals'), {
      recursive: true,
    });
    mkdirSync(fillers, { recursive: true });
    writeFileSync(join(fillers, 'grid-filler-600x400-a.png'), 'merchant bytes');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    expect(() => applyPilotPublicGate(configDir, BUILD_ARGV)).toThrow(
      /does not match the pinned hash/
    );
  });

  it('keeps an agreeing operator BACI_PILOT_PUBLIC_DIR preset', () => {
    // An agreeing preset stays (same tree, operator spelling): the
    // comparison is canonical, so a symlinked-ancestor spelling of
    // the same tree agrees instead of refusing.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    mkdirSync(join(configDir, 'public'), { recursive: true });
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv(
      'BACI_PILOT_PUBLIC_DIR',
      realpathSync(join(configDir, 'public'))
    );
    for (const argv of [BUILD_ARGV, DEV_ARGV, START_ARGV]) {
      const publicDir = applyPilotPublicGate(configDir, argv);
      expect(publicDir).toBe(join(configDir, 'public'));
      expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe(
        realpathSync(join(configDir, 'public'))
      );
    }
  });

  it('refuses a preset that disagrees with the served config tree', () => {
    // The boot gate and request resolver trust the stash: a stale
    // preset would validate and bind a tree Next never serves, so
    // the process refuses instead of stashing either spelling.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/operator/tree/public');
    for (const argv of [BUILD_ARGV, DEV_ARGV, START_ARGV]) {
      expect(() => applyPilotPublicGate(configDir, argv)).toThrow(
        /preset .* disagrees with the served config tree/
      );
    }
  });

  it('stashes the config tree when the preset is empty', () => {
    // Empty counts as unset (downstream treats it as unset too), so
    // the config anchor fills it rather than leaving the boot
    // unanchored.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    const publicDir = applyPilotPublicGate(configDir, DEV_ARGV);
    expect(publicDir).toBe(join(configDir, 'public'));
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe(join(configDir, 'public'));
  });
});
