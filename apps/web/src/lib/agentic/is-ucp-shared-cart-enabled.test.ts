import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnonMerchantFeatureLookup } from '@/lib/cart/merchant-resolution';
import { isUcpSharedCartEnabled } from './is-ucp-shared-cart-enabled';

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/cart/merchant-resolution', () => ({
  createAnonMerchantFeatureLookup: vi.fn(),
}));

function mockFeatures(features: unknown) {
  vi.mocked(createAnonMerchantFeatureLookup).mockReturnValue(
    vi.fn(async () => features) as never
  );
}

describe('isUcpSharedCartEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is true when the merchant holds the shared_cart grant', async () => {
    mockFeatures({ premium_features: ['shared_cart'] });
    await expect(isUcpSharedCartEnabled('merchant-1')).resolves.toBe(true);
  });

  it('is false without the grant', async () => {
    mockFeatures({ premium_features: [] });
    await expect(isUcpSharedCartEnabled('merchant-1')).resolves.toBe(false);
  });

  it('throws when the merchant cannot be read, so callers fail closed', async () => {
    mockFeatures(null);
    await expect(isUcpSharedCartEnabled('merchant-1')).rejects.toThrow(
      'Merchant unavailable'
    );
  });
});
