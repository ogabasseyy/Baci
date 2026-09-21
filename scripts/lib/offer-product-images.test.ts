import { describe, expect, it, vi } from 'vitest';
import { appendOfferProductImages } from './offer-product-images';

const { mockAppend } = vi.hoisted(() => ({ mockAppend: vi.fn() }));

vi.mock('./feed-offer-image-backfill', () => ({
  appendOfferImageCandidates: (...args: unknown[]) => mockAppend(...args),
}));

const ROW = { candidate: { product_id: 'p1' }, classified: {} };

describe('appendOfferProductImages', () => {
  it('passes only flagged products with their conditions', async () => {
    mockAppend.mockResolvedValue([ROW]);
    const supabase = {};
    const result = await appendOfferProductImages({
      supabase: supabase as never,
      products: [
        { id: 'p1', condition: 'new', has_condition_offers: true },
        { id: 'p2', condition: 'used', has_condition_offers: false },
        { id: 'p3', condition: 'used' },
      ],
      merchantId: 'm-1',
      storefrontBaseUrl: 'https://store.example',
      productRows: [],
    });

    expect(result).toEqual([ROW]);
    expect(mockAppend).toHaveBeenCalledWith({
      supabase,
      productIds: ['p1'],
      merchantId: 'm-1',
      storefrontBaseUrl: 'https://store.example',
      productRows: [],
      productConditions: new Map([['p1', 'new']]),
    });
  });

  it('propagates backfill failures', async () => {
    mockAppend.mockRejectedValue(new Error('boom'));
    await expect(
      appendOfferProductImages({
        supabase: {} as never,
        products: [{ id: 'p1', has_condition_offers: true }],
        merchantId: 'm-1',
        storefrontBaseUrl: 'https://store.example',
        productRows: [],
      })
    ).rejects.toThrow('boom');
  });
});
