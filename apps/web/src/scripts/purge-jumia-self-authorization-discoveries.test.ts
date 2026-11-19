import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateAdminClient = vi.fn(() => ({ client: 'admin' }));
const mockPurge = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));
vi.mock(
  '@/lib/jumia/purge-expired-jumia-self-authorization-discoveries',
  () => ({
    purgeExpiredJumiaSelfAuthorizationDiscoveries: (...args: unknown[]) =>
      mockPurge(...args),
  })
);

import { runPurgeJumiaSelfAuthorizationDiscoveriesCli } from './purge-jumia-self-authorization-discoveries';

describe('purge-jumia-self-authorization-discoveries CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('purges expired discoveries and returns 0', async () => {
    mockPurge.mockResolvedValueOnce(4);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await expect(
        runPurgeJumiaSelfAuthorizationDiscoveriesCli()
      ).resolves.toBe(0);
      expect(mockPurge).toHaveBeenCalledWith({ client: 'admin' });
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ deleted: 4 }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('propagates purge errors', async () => {
    mockPurge.mockRejectedValueOnce(new Error('RPC unavailable'));

    await expect(
      runPurgeJumiaSelfAuthorizationDiscoveriesCli()
    ).rejects.toThrow('RPC unavailable');
  });
});
