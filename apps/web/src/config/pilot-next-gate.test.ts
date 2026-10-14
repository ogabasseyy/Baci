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
import { applyPilotPublicGate } from './pilot-next-gate';

describe('applyPilotPublicGate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.BACI_PILOT_PUBLIC_DIR;
  });

  it('stashes the config-anchored public dir for the boot gate', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const publicDir = applyPilotPublicGate(configDir);
    expect(publicDir).toBe(join(configDir, 'public'));
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe(join(configDir, 'public'));
  });

  it('refuses staged data in non-lab mode like the inline gate', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    mkdirSync(join(configDir, 'public', '__pilot', 'originals'), {
      recursive: true,
    });
    writeFileSync(
      join(configDir, 'public', '__pilot', 'originals', 'staged.png'),
      'staged'
    );
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    expect(() => applyPilotPublicGate(configDir)).toThrow(
      /staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1/
    );
    // The build refuses without mutating: quarantine is runtime-only.
    expect(
      existsSync(
        join(configDir, 'public', '__pilot', 'originals', 'staged.png')
      )
    ).toBe(true);
  });
  it('refuses a merchant image renamed to a pinned filler name', () => {
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
    expect(() => applyPilotPublicGate(configDir)).toThrow(
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
    const publicDir = applyPilotPublicGate(configDir);
    expect(publicDir).toBe(join(configDir, 'public'));
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe(
      realpathSync(join(configDir, 'public'))
    );
  });

  it('refuses a preset that disagrees with the served config tree', () => {
    // The boot gate and request resolver trust the stash: a stale
    // preset would validate and bind a tree Next never serves, so
    // the build refuses instead of stashing either spelling.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/operator/tree/public');
    expect(() => applyPilotPublicGate(configDir)).toThrow(
      /preset .* disagrees with the served config tree/
    );
  });

  it('stashes the config tree when the preset is empty', () => {
    // Empty counts as unset (downstream treats it as unset too), so
    // the config anchor fills it rather than leaving the boot
    // unanchored.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    const publicDir = applyPilotPublicGate(configDir);
    expect(publicDir).toBe(join(configDir, 'public'));
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe(join(configDir, 'public'));
  });
});
