import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRepairPickupPaymentMerchant } from './resolve-repair-pickup-payment-merchant';

const mocks = vi.hoisted(() => ({
  resolveWalletTopUpMerchant: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/resolve-wallet-top-up-merchant', () => ({
  resolveWalletTopUpMerchant: mocks.resolveWalletTopUpMerchant,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';

describe('resolveRepairPickupPaymentMerchant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWalletTopUpMerchant.mockResolvedValue({
      business_type: 'electronics',
      id: merchantId,
      is_published: true,
      slug: 'ogabassey',
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  async function resolve() {
    return resolveRepairPickupPaymentMerchant({
      merchantId,
      merchantSlug: 'ogabassey',
      supabase: { rpc: mocks.rpc } as never,
    });
  }

  it('returns id and slug when published and catalogue-enabled', async () => {
    await expect(resolve()).resolves.toEqual({
      id: merchantId,
      slug: 'ogabassey',
    });
    expect(mocks.resolveWalletTopUpMerchant).toHaveBeenCalledWith(
      expect.anything(),
      { merchantId, merchantSlug: 'ogabassey' },
      'id, slug, is_published, business_type'
    );
    expect(mocks.rpc).toHaveBeenCalledWith('repairs_catalog_publicly_enabled', {
      p_merchant_id: merchantId,
    });
  });

  it('fails closed when the public catalogue gate is off', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(resolve()).resolves.toBeNull();
  });

  it('fails closed when business_type is not repairs-eligible', async () => {
    mocks.resolveWalletTopUpMerchant.mockResolvedValueOnce({
      business_type: 'fashion',
      id: merchantId,
      is_published: true,
      slug: 'ogabassey',
    });
    await expect(resolve()).resolves.toBeNull();
  });

  it('fails closed when the store is unpublished', async () => {
    mocks.resolveWalletTopUpMerchant.mockResolvedValueOnce({
      business_type: 'electronics',
      id: merchantId,
      is_published: false,
      slug: 'ogabassey',
    });
    await expect(resolve()).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
