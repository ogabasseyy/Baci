import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => vi.fn());
vi.mock('./src/config/pilot-public-assets', () => ({
  assertPilotPublicAssets: guard,
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('Next build public pilot gate', () => {
  it('checks the app public tree while loading build configuration', async () => {
    const config = (await import('./next.config')).default;
    config(PHASE_PRODUCTION_BUILD);
    // Build is the enforcement point: both drift and content findings
    // refuse here (runtime boots downgrade content findings to warn).
    expect(guard).toHaveBeenCalledWith(
      expect.stringMatching(/apps\/web\/public$/),
      undefined,
      'throw',
      'throw'
    );
  });
  it('refuses configuration when public staging is unsafe', async () => {
    guard.mockImplementationOnce(() => {
      throw new Error('staged merchant pilot assets');
    });
    const config = (await import('./next.config')).default;
    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(
      'staged merchant pilot assets'
    );
  });
  it('skips the gate for unrelated config evaluation', async () => {
    // The export is a function of Next's phase: merely importing the
    // config (typegen, tests, tooling) never runs the gate — no
    // assert, no throw, no env mutation.
    await import('./next.config');
    expect(guard).not.toHaveBeenCalled();
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBeUndefined();
  });
});
