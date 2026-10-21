import { describe, expect, it, vi } from 'vitest';
import { fetchOfferResolutions } from './fetch-offer-resolutions';
import { OfferAuthorityInputError } from './offer-authority-input-error';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';
const MERCHANT_ID = '33333333-3333-4333-8333-333333333333';

describe('fetchOfferResolutions', () => {
  it('batches product ids into a single call', async () => {
    const callRpc = vi.fn().mockResolvedValue({
      data: [{ product_id: PRODUCT_ID, offer_id: OFFER_ID, price_basis: 80 }],
      error: null,
    });
    const map = await fetchOfferResolutions(callRpc, {
      merchantId: MERCHANT_ID,
      productIds: [PRODUCT_ID, PRODUCT_ID],
    });
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith({
      p_merchant_id: MERCHANT_ID,
      p_product_ids: [PRODUCT_ID],
    });
    expect(map.get(`${PRODUCT_ID}::${OFFER_ID}`)?.priceBasis).toBe(80);
  });

  it('chunks unscoped batches at the 200-id cap and merges', async () => {
    const ids = Array.from(
      { length: 201 },
      (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
    );
    const callRpc = vi.fn(async (args: { p_product_ids: string[] }) => ({
      data: args.p_product_ids.map((id) => ({
        product_id: id,
        offer_id: OFFER_ID,
        price_basis: 80,
      })),
      error: null,
    }));
    const map = await fetchOfferResolutions(callRpc, {
      merchantId: null,
      productIds: ids,
    });
    expect(callRpc).toHaveBeenCalledTimes(2);
    expect(callRpc.mock.calls[0][0].p_product_ids).toHaveLength(200);
    expect(callRpc.mock.calls[1][0].p_product_ids).toHaveLength(1);
    expect(map.size).toBe(201);
    expect(map.get(`${ids[200]}::${OFFER_ID}`)?.priceBasis).toBe(80);
  });

  it('keeps a 1000-id merchant-scoped batch in a single call', async () => {
    const ids = Array.from(
      { length: 1000 },
      (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
    );
    const callRpc = vi.fn(
      async (args: {
        p_merchant_id: string | null;
        p_product_ids: string[];
      }) => ({
        data: args.p_product_ids.map((id) => ({
          product_id: id,
          offer_id: OFFER_ID,
          price_basis: 80,
        })),
        error: null,
      })
    );
    const map = await fetchOfferResolutions(callRpc, {
      merchantId: MERCHANT_ID,
      productIds: ids,
    });
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc.mock.calls[0][0].p_merchant_id).toBe(MERCHANT_ID);
    expect(map.size).toBe(1000);
  });

  it('chunks merchant-scoped batches past the 1000-id cap', async () => {
    const ids = Array.from(
      { length: 1001 },
      (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
    );
    const callRpc = vi.fn(async (args: { p_product_ids: string[] }) => ({
      data: args.p_product_ids.map((id) => ({
        product_id: id,
        offer_id: OFFER_ID,
        price_basis: 80,
      })),
      error: null,
    }));
    const map = await fetchOfferResolutions(callRpc, {
      merchantId: MERCHANT_ID,
      productIds: ids,
    });
    expect(callRpc).toHaveBeenCalledTimes(2);
    expect(callRpc.mock.calls[0][0].p_product_ids).toHaveLength(1000);
    expect(callRpc.mock.calls[1][0].p_product_ids).toHaveLength(1);
    expect(map.size).toBe(1001);
  });

  it('skips the call when no ids are given', async () => {
    const callRpc = vi.fn();
    expect(await fetchOfferResolutions(callRpc, { productIds: [] })).toEqual(
      new Map()
    );
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('fails closed on malformed ids without calling the RPC', async () => {
    const callRpc = vi.fn();
    await expect(
      fetchOfferResolutions(callRpc, { productIds: ['not-a-uuid'] })
    ).rejects.toBeInstanceOf(OfferAuthorityInputError);
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed merchant id without calling the RPC', async () => {
    const callRpc = vi.fn();
    await expect(
      fetchOfferResolutions(callRpc, {
        merchantId: 'not-a-uuid',
        productIds: [PRODUCT_ID],
      })
    ).rejects.toBeInstanceOf(OfferAuthorityInputError);
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('throws lookup errors for the caller to report', async () => {
    const callRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    await expect(
      fetchOfferResolutions(callRpc, { productIds: [PRODUCT_ID] })
    ).rejects.toThrow('boom');
  });
});
