import { describe, expect, it, vi } from 'vitest';
import {
  consumeJumiaSelfAuthorizationDiscovery,
  releaseJumiaSelfAuthorizationDiscovery,
} from '@/lib/jumia/self-authorization-discovery-store';
import { cleanupJumiaSelectionDiscovery } from './cleanup-jumia-selection-discovery';

vi.mock('@/lib/jumia/self-authorization-discovery-store', () => ({
  consumeJumiaSelfAuthorizationDiscovery: vi.fn(),
  releaseJumiaSelfAuthorizationDiscovery: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

describe('cleanupJumiaSelectionDiscovery', () => {
  it('consumes a completed discovery', async () => {
    await cleanupJumiaSelectionDiscovery({
      supabase: {} as never,
      discoveryId: 'discovery-1',
      merchantId: 'merchant-1',
      clientKeyHash: 'a'.repeat(64),
      claimToken: 'claim-1',
      discoveryComplete: true,
    });

    expect(consumeJumiaSelfAuthorizationDiscovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ discoveryId: 'discovery-1' })
    );
    expect(releaseJumiaSelfAuthorizationDiscovery).not.toHaveBeenCalled();
  });

  it('releases an incomplete discovery and swallows cleanup failures', async () => {
    vi.mocked(releaseJumiaSelfAuthorizationDiscovery).mockRejectedValueOnce(
      new Error('cleanup unavailable')
    );

    await expect(
      cleanupJumiaSelectionDiscovery({
        supabase: {} as never,
        discoveryId: 'discovery-1',
        merchantId: 'merchant-1',
        clientKeyHash: 'a'.repeat(64),
        claimToken: 'claim-1',
        discoveryComplete: false,
      })
    ).resolves.toBeUndefined();

    expect(releaseJumiaSelfAuthorizationDiscovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ discoveryId: 'discovery-1' })
    );
  });
});
