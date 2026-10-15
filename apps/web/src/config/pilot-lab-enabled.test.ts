import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPilotLabEnabled } from './pilot-lab-enabled';

describe('isPilotLabEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enables the lab for flag-local runs', () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    expect(isPilotLabEnabled()).toBe(true);
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    expect(isPilotLabEnabled()).toBe(false);
  });

  it('refuses every Vercel deployment even with the flag', () => {
    // Development URLs can be publicly reachable, so no Vercel env —
    // production, preview, or development — can enable the lab.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    for (const env of ['production', 'preview', 'development']) {
      vi.stubEnv('VERCEL_ENV', env);
      expect(isPilotLabEnabled()).toBe(false);
    }
  });

  it('refuses standalone production without the explicit acknowledgement', () => {
    // The VPS/standalone runner sets no VERCEL_ENV: NODE_ENV alone
    // must block the lab, or a copied flag exposes staged bytes.
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_ALLOW_PROD', '');
    expect(isPilotLabEnabled()).toBe(false);
    // Deliberate acknowledgement re-enables: auditable, and never
    // copied by accident with the lab flag alone.
    vi.stubEnv('BACI_IMAGE_PILOT_ALLOW_PROD', '1');
    expect(isPilotLabEnabled()).toBe(true);
  });

  it('keeps the Vercel block unconditional', () => {
    // The acknowledgement covers standalone production only; Vercel
    // production stays hard-blocked.
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_ALLOW_PROD', '1');
    expect(isPilotLabEnabled()).toBe(false);
  });
});
