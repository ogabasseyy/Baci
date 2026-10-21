import { describe, expect, it, vi } from 'vitest';
import { createOfferAuthorityRpcCall } from './offer-authority-rpc';

describe('createOfferAuthorityRpcCall', () => {
  it('calls the authority RPC and passes rows through', async () => {
    const rows = [{ product_id: 'p1', offer_id: 'o1' }];
    const rpc = vi.fn(async () => ({ data: rows, error: null }));
    const call = createOfferAuthorityRpcCall({ rpc });

    await expect(
      call({ p_merchant_id: null, p_product_ids: ['p1'] })
    ).resolves.toEqual({ data: rows, error: null });
    expect(rpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
      p_merchant_id: null,
      p_product_ids: ['p1'],
    });
  });

  it('normalizes RPC errors to a message shape', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'boom', code: '500', details: '', hint: '' },
    }));
    const call = createOfferAuthorityRpcCall({ rpc });

    await expect(
      call({ p_merchant_id: 'm1', p_product_ids: ['p1'] })
    ).resolves.toEqual({ data: null, error: { message: 'boom' } });
  });
});
