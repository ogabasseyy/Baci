import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_EXPORT,
  PHASE_INFO,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
  PHASE_TEST,
} from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPilotPublicGate, classifyGatePhase } from './pilot-next-gate';

describe('classifyGatePhase', () => {
  it.each([
    ['production build', PHASE_PRODUCTION_BUILD, 'build'],
    ['production server', PHASE_PRODUCTION_SERVER, 'start'],
    ['development server', PHASE_DEVELOPMENT_SERVER, 'dev'],
    ['test phase', PHASE_TEST, 'other'],
    ['info phase', PHASE_INFO, 'other'],
    ['export phase', PHASE_EXPORT, 'other'],
    ['unknown phase', 'phase-something-else', 'other'],
    ['missing phase', undefined, 'other'],
  ])('%s classifies as %s', (_name, phase, gatePhase) => {
    expect(classifyGatePhase(phase)).toBe(gatePhase);
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
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]) {
      delete process.env.BACI_PILOT_PUBLIC_DIR;
      const publicDir = applyPilotPublicGate(configDir, phase);
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
    expect(() =>
      applyPilotPublicGate(configDir, PHASE_PRODUCTION_BUILD)
    ).toThrow(/staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1/);
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
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]) {
      expect(() => applyPilotPublicGate(configDir, phase)).not.toThrow();
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
    for (const phase of [PHASE_TEST, PHASE_INFO, undefined]) {
      const publicDir = applyPilotPublicGate(configDir, phase);
      expect(publicDir).toBe(join(configDir, 'public'));
      expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe('/operator/tree/public');
    }
  });

  it('refuses filler drift at build when the lab is enabled', () => {
    // Lab builds need exact fixtures (measurement exactness): a
    // drifted filler fails the build rather than corrupting the
    // comparison.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    const fillers = join(configDir, 'public', '__pilot', 'fillers');
    mkdirSync(join(configDir, 'public', '__pilot', 'originals'), {
      recursive: true,
    });
    mkdirSync(fillers, { recursive: true });
    writeFileSync(join(fillers, 'grid-filler-600x400-a.png'), 'merchant bytes');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    expect(() =>
      applyPilotPublicGate(configDir, PHASE_PRODUCTION_BUILD)
    ).toThrow(/unapproved filler/);
  });

  it('warns on filler drift at build when the lab is disabled', () => {
    // Synthetic fixtures must not brick unrelated storefront
    // deploys: a pipeline recompression is not tamper, and staged
    // content still refuses every build (see above). Lab boots
    // re-assert exact fillers, so drift never enters a lab run.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    const fillers = join(configDir, 'public', '__pilot', 'fillers');
    mkdirSync(join(configDir, 'public', '__pilot', 'originals'), {
      recursive: true,
    });
    mkdirSync(fillers, { recursive: true });
    writeFileSync(join(fillers, 'grid-filler-600x400-a.png'), 'merchant bytes');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        applyPilotPublicGate(configDir, PHASE_PRODUCTION_BUILD)
      ).not.toThrow();
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).match(/does not match the pinned hash/)
        )
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
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
    for (const phase of [
      PHASE_PRODUCTION_BUILD,
      PHASE_DEVELOPMENT_SERVER,
      PHASE_PRODUCTION_SERVER,
    ]) {
      const publicDir = applyPilotPublicGate(configDir, phase);
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
    for (const phase of [
      PHASE_PRODUCTION_BUILD,
      PHASE_DEVELOPMENT_SERVER,
      PHASE_PRODUCTION_SERVER,
    ]) {
      expect(() => applyPilotPublicGate(configDir, phase)).toThrow(
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
    const publicDir = applyPilotPublicGate(configDir, PHASE_DEVELOPMENT_SERVER);
    expect(publicDir).toBe(join(configDir, 'public'));
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe(join(configDir, 'public'));
  });
});

describe('stash origin vs pilot intent', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.BACI_PILOT_PUBLIC_DIR;
  });

  it('excludes the automatic stash from pilot intent', async () => {
    // The gate auto-stashes on dev/start when the operator set no
    // preset; that automatic value must not count as intent, or
    // every boot shows intent and the warn paths never trigger (a
    // recompressed filler would pass the non-lab build as a warning
    // and then fail every boot as fatal). Fresh modules per case:
    // the origin marker is process state, and real processes
    // evaluate the gate once.
    vi.resetModules();
    const { applyPilotPublicGate: gate } = await import('./pilot-next-gate');
    const { hasPilotIntent } = await import('./pilot-public-assets-unanchored');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    gate(configDir, PHASE_DEVELOPMENT_SERVER);
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe(join(configDir, 'public'));
    expect(hasPilotIntent()).toBe(false);
  });

  it('counts an operator preset as pilot intent', async () => {
    vi.resetModules();
    const { applyPilotPublicGate: gate } = await import('./pilot-next-gate');
    const { hasPilotIntent } = await import('./pilot-public-assets-unanchored');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', join(configDir, 'public'));
    gate(configDir, PHASE_DEVELOPMENT_SERVER);
    expect(hasPilotIntent()).toBe(true);
  });
});
