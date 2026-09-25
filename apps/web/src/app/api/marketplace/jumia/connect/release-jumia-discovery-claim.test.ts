import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseJumiaDiscoveryClaim } from './release-jumia-discovery-claim';

const { mockRelease, mockWarn } = vi.hoisted(() => ({
  mockRelease: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('@/lib/jumia/self-authorization-discovery-store', () => ({
  releaseJumiaSelfAuthorizationDiscovery: mockRelease,
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: mockWarn } }));

const args = {
  claimToken: 'claim-1',
  discoveryId: 'discovery-1',
  merchantId: 'merchant-1',
  supabase: {} as never,
};

describe('releaseJumiaDiscoveryClaim', () => {
  beforeEach(() => vi.clearAllMocks());

  it('releases the discovery claim', async () => {
    await releaseJumiaDiscoveryClaim(args);

    expect(mockRelease).toHaveBeenCalledWith(args.supabase, args);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('logs and resolves when claim cleanup fails', async () => {
    mockRelease.mockRejectedValueOnce(new Error('temporary failure'));

    await expect(releaseJumiaDiscoveryClaim(args)).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to release Jumia discovery claim',
        discovery_id: 'discovery-1',
        merchant_id: 'merchant-1',
      })
    );
  });
});
