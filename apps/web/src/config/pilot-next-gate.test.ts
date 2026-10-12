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
});
