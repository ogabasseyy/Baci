import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

  it('preserves an explicit operator BACI_PILOT_PUBLIC_DIR preset', () => {
    // Set-if-unset: an operator/CI preset names a different tree on
    // purpose, so the config-time stash must not overwrite it. The
    // gate still checks (and returns) the config-anchored tree.
    const configDir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/operator/tree/public');
    const publicDir = applyPilotPublicGate(configDir);
    expect(publicDir).toBe(join(configDir, 'public'));
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBe('/operator/tree/public');
  });
});
