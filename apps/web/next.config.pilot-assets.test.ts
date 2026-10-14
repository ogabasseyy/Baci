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
    await import('./next.config');
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
    await expect(import('./next.config')).rejects.toThrow(
      'staged merchant pilot assets'
    );
  });
});
