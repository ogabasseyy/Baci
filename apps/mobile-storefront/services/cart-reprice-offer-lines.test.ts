import { describe, expect, it, jest } from '@jest/globals';
import { getStorefrontProductOffersByProductIds } from '@/lib/fetch-storefront-product-offers';
import type { CartItem } from '@/stores/cart-store';
import {
  collectOfferLineProductIds,
  fetchLiveOfferRepriceMap,
  getDriftedOfferCondition,
  pickChangedConditionById,
  resolveOfferLinePrice,
} from './cart-reprice-offer-lines';

jest.mock('@/lib/fetch-storefront-product-offers', () => ({
  getStorefrontProductOffersByProductIds: jest.fn(),
}));

const mockGetOffers =
  getStorefrontProductOffersByProductIds as jest.MockedFunction<
    typeof getStorefrontProductOffersByProductIds
  >;

function offerLine(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'offer-line',
    product_id: 'offer-product',
    slug: 'slug',
    name: 'Item',
    price: 280000,
    quantity: 1,
    offer_id: 'offer-7',
    ...overrides,
  } as CartItem;
}

describe('collectOfferLineProductIds', () => {
  it('collects distinct product ids behind exact offer lines only', () => {
    const ids = collectOfferLineProductIds([
      offerLine(),
      offerLine({ id: 'offer-line-2' }),
      offerLine({ id: 'variant-line', variant_id: 'v1' }),
      offerLine({ id: 'base-line', offer_id: undefined }),
      offerLine({ id: 'other-line', product_id: 'other-product' }),
    ]);

    expect(ids).toEqual(['offer-product', 'other-product']);
  });
});

describe('fetchLiveOfferRepriceMap', () => {
  it('maps live rows by offer id with their conditions', async () => {
    mockGetOffers.mockResolvedValue({
      'offer-product': [
        { id: 'offer-7', price: 280000, condition: 'used' },
        { id: 'offer-9', price: null, condition: 'new' },
      ],
    });

    const { map, failed } = await fetchLiveOfferRepriceMap(['offer-product']);

    expect(failed).toBe(false);
    expect(map.get('offer-7')).toEqual({
      price: 280000,
      productId: 'offer-product',
      condition: 'used',
    });
    expect(map.has('offer-9')).toBe(false);
  });

  it('fails open without fetching when no offer lines exist', async () => {
    mockGetOffers.mockClear();

    const { map, failed } = await fetchLiveOfferRepriceMap([]);

    expect(failed).toBe(false);
    expect(map.size).toBe(0);
    expect(mockGetOffers).not.toHaveBeenCalled();
  });

  it('fails open when the lookup fails', async () => {
    mockGetOffers.mockResolvedValue(null);

    const { map, failed } = await fetchLiveOfferRepriceMap(['offer-product']);

    expect(failed).toBe(true);
    expect(map.size).toBe(0);
  });
});

describe('resolveOfferLinePrice', () => {
  const rows = new Map([
    [
      'offer-7',
      { price: 280000, productId: 'offer-product', condition: 'used' },
    ],
  ]);

  it('resolves a matching live row', () => {
    expect(resolveOfferLinePrice(offerLine(), rows)).toEqual({
      price: 280000,
      condition: 'used',
    });
  });

  it('rejects rows from another product', () => {
    expect(
      resolveOfferLinePrice(offerLine({ product_id: 'other' }), rows)
    ).toBeNull();
  });

  it('rejects missing and non-positive rows but accepts zero', () => {
    expect(
      resolveOfferLinePrice(offerLine({ offer_id: 'gone' }), rows)
    ).toBeNull();
    expect(
      resolveOfferLinePrice(
        offerLine(),
        new Map([
          [
            'offer-7',
            { price: 0, productId: 'offer-product', condition: 'used' },
          ],
        ])
      )
    ).toEqual({ price: 0, condition: 'used' });
    expect(
      resolveOfferLinePrice(
        offerLine(),
        new Map([
          [
            'offer-7',
            {
              price: Number.NaN,
              productId: 'offer-product',
              condition: 'used',
            },
          ],
        ])
      )
    ).toBeNull();
  });
});

describe('getDriftedOfferCondition', () => {
  it('returns the live condition on canonical drift', () => {
    expect(getDriftedOfferCondition('used', 'refurbished')).toBe('refurbished');
  });

  it('returns null when conditions match or cannot reconcile', () => {
    expect(getDriftedOfferCondition('used', 'used')).toBeNull();
    expect(getDriftedOfferCondition(undefined, 'used')).toBeNull();
    expect(getDriftedOfferCondition('used', null)).toBeNull();
    expect(getDriftedOfferCondition('used', '')).toBeNull();
  });
});

describe('pickChangedConditionById', () => {
  it('picks live conditions for changed lines only', () => {
    expect(
      pickChangedConditionById({
        changes: [{ id: 'a' }, { id: 'b' }],
        conditionById: { a: 'refurbished' },
      })
    ).toEqual({ a: 'refurbished' });
  });
});
