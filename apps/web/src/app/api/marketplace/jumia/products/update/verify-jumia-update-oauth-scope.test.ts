import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyScope = vi.fn();

vi.mock('@/lib/jumia/verify-jumia-single-marketplace-scope', () => ({
  verifyJumiaSingleMarketplaceScope: (...args: unknown[]) =>
    mockVerifyScope(...args),
}));

import { getJumiaOAuthScopeError } from './verify-jumia-update-oauth-scope';

describe('getJumiaOAuthScopeError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through integrations that emit a business-client selector', async () => {
    await expect(
      getJumiaOAuthScopeError(
        { shopId: 'shop-1', marketplaceKey: 'NG-RETAIL' } as never,
        'Status'
      )
    ).resolves.toBeNull();
    expect(mockVerifyScope).not.toHaveBeenCalled();
  });

  it('passes an OAuth shop with one active business client', async () => {
    mockVerifyScope.mockResolvedValue({ ok: true });

    await expect(
      getJumiaOAuthScopeError(
        { shopId: 'shop-1', marketplaceKey: 'oauth' } as never,
        'Price'
      )
    ).resolves.toBeNull();
    expect(mockVerifyScope).toHaveBeenCalledWith(
      expect.objectContaining({ marketplaceKey: 'oauth' }),
      { strictOAuth: true }
    );
  });

  it('denies an OAuth shop with multiple business clients', async () => {
    mockVerifyScope.mockResolvedValue({
      ok: false,
      reason: 'multiple_active_marketplaces',
    });

    await expect(
      getJumiaOAuthScopeError(
        { shopId: 'shop-1', marketplaceKey: 'oauth' } as never,
        'Status'
      )
    ).resolves.toBe(
      'Status update skipped: Jumia status updates cannot target a selected marketplace when the OAuth shop exposes multiple business clients.'
    );
  });

  it('reports unverifiable OAuth scope as retryable', async () => {
    mockVerifyScope.mockResolvedValue({
      ok: false,
      reason: 'provider_unavailable',
    });

    await expect(
      getJumiaOAuthScopeError(
        { shopId: 'shop-1', marketplaceKey: 'oauth' } as never,
        'Price'
      )
    ).resolves.toBe(
      'Price update skipped: unable to verify the Jumia shop marketplace scope. Try again.'
    );
  });
});
