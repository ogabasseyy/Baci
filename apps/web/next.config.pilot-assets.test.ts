import { afterEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => vi.fn());
vi.mock('./src/config/pilot-public-assets', () => ({
  assertPilotPublicAssets: guard,
}));

const savedArgv = process.argv;
afterEach(() => {
  process.argv = savedArgv;
  vi.resetModules();
  vi.clearAllMocks();
});

describe('Next build public pilot gate', () => {
  it('checks the app public tree while loading build configuration', async () => {
    process.argv = ['node', '/repo/node_modules/next/dist/bin/next', 'build'];
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
    process.argv = ['node', '/repo/node_modules/next/dist/bin/next', 'build'];
    guard.mockImplementationOnce(() => {
      throw new Error('staged merchant pilot assets');
    });
    await expect(import('./next.config')).rejects.toThrow(
      'staged merchant pilot assets'
    );
  });
  it('skips the gate for unrelated config evaluation', async () => {
    // Typegen, tests, and tooling import next.config without booting
    // or serving: no assert, no throw, no env mutation.
    process.argv = ['node', '/repo/node_modules/vitest/vitest.mjs', 'run'];
    await import('./next.config');
    expect(guard).not.toHaveBeenCalled();
    expect(process.env.BACI_PILOT_PUBLIC_DIR).toBeUndefined();
  });
});
