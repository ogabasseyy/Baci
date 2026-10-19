import { describe, expect, it, jest } from '@jest/globals';
import { getStorefrontProductOffersByProductIds } from '@/lib/fetch-storefront-product-offers';
import type { CartItem } from '@/stores/cart-store';
import type { LiveOfferRepriceMap } from './cart-reprice-offer-lines';
import {
  collectLegacyOfferLineProductIds,
  collectOfferLineProductIds,
  fetchLiveOfferRepriceMap,
  getDriftedOfferCondition,
  isParentPricedOfferlessLine,
  pickChangedConditionById,
  pickChangedOfferIdById,
  resolveLegacyOfferId,
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
        { id: 'offer-7', price: 280000, condition: 'used', stock_quantity: 4 },
        { id: 'offer-9', price: null, condition: 'new', stock_quantity: 2 },
      ],
    });

    const { map, failed } = await fetchLiveOfferRepriceMap(['offer-product']);

    expect(failed).toBe(false);
    expect(map.get('offer-7')).toEqual({
      price: 280000,
      productId: 'offer-product',
      condition: 'used',
      stockQuantity: 4,
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
      {
        price: 280000,
        productId: 'offer-product',
        condition: 'used',
        stockQuantity: 4,
      },
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
            {
              price: 0,
              productId: 'offer-product',
              condition: 'used',
              stockQuantity: 4,
            },
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
              stockQuantity: 4,
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

describe('isParentPricedOfferlessLine', () => {
  it.each([
    [{ condition: undefined }, 'new', true],
    [{ condition: '' }, 'new', true],
    [{ condition: 'new' }, 'new', true],
    [{ condition: 'New' }, 'new', true],
    [{ condition: 'used' }, 'used', true],
    [{ condition: undefined }, null, true],
    [{ condition: 'new' }, null, true],
    [{ condition: 'used' }, 'new', false],
    [{ condition: 'Open Box' }, 'new', false],
    [{ condition: 'refurbished' }, 'new', false],
    [{ condition: 'new' }, 'used', false],
  ])('line %j on parent %j is parent-priced: %j', (line, parent, expected) => {
    expect(
      isParentPricedOfferlessLine(line, parent as string | null | undefined)
    ).toBe(expected);
  });
});

describe('collectLegacyOfferLineProductIds', () => {
  it('collects products behind offerless non-variant lines on offer-products', () => {
    const ids = collectLegacyOfferLineProductIds(
      [
        offerLine({ id: 'legacy', offer_id: undefined }),
        offerLine({ id: 'exact', offer_id: 'offer-1' }),
        offerLine({
          id: 'variant',
          offer_id: undefined,
          variant_id: 'v1',
        }),
        offerLine({
          id: 'plain',
          offer_id: undefined,
          product_id: 'plain-product',
        }),
      ],
      new Set(['offer-product'])
    );

    expect(ids).toEqual(['offer-product']);
  });
});

describe('resolveLegacyOfferId', () => {
  function offerMap(
    rows: Array<{ id: string; product: string; condition: string | null }>
  ): LiveOfferRepriceMap {
    return new Map(
      rows.map((row) => [
        row.id,
        {
          price: 1,
          productId: row.product,
          condition: row.condition,
          stockQuantity: null,
        },
      ])
    );
  }

  it('resolves the single live offer matching the stored condition', () => {
    expect(
      resolveLegacyOfferId(
        offerLine({ offer_id: undefined, condition: 'Open Box' }),
        offerMap([
          { id: 'offer-1', product: 'offer-product', condition: 'open_box' },
          { id: 'offer-2', product: 'offer-product', condition: 'used' },
        ])
      )
    ).toBe('offer-1');
  });

  it('returns null when no live offer matches', () => {
    expect(
      resolveLegacyOfferId(
        offerLine({ offer_id: undefined, condition: 'Open Box' }),
        offerMap([
          { id: 'offer-2', product: 'offer-product', condition: 'used' },
        ])
      )
    ).toBeNull();
  });

  it('returns null when two live offers share the condition', () => {
    expect(
      resolveLegacyOfferId(
        offerLine({ offer_id: undefined, condition: 'used' }),
        offerMap([
          { id: 'offer-1', product: 'offer-product', condition: 'used' },
          { id: 'offer-2', product: 'offer-product', condition: 'uk_used' },
        ])
      )
    ).toBeNull();
  });

  it('ignores other products and null live conditions', () => {
    expect(
      resolveLegacyOfferId(
        offerLine({ offer_id: undefined, condition: 'used' }),
        offerMap([
          { id: 'offer-x', product: 'other-product', condition: 'used' },
          { id: 'offer-n', product: 'offer-product', condition: null },
        ])
      )
    ).toBeNull();
  });

  it('returns null for lines without a stored condition', () => {
    expect(
      resolveLegacyOfferId(
        offerLine({ offer_id: undefined, condition: undefined }),
        offerMap([
          { id: 'offer-1', product: 'offer-product', condition: 'used' },
        ])
      )
    ).toBeNull();
  });
});

describe('pickChangedOfferIdById', () => {
  it('picks adopted ids for adopted lines only', () => {
    expect(
      pickChangedOfferIdById({
        adoptions: [{ id: 'a' }],
        offerIdById: { a: 'offer-1', b: 'offer-2' },
      })
    ).toEqual({ a: 'offer-1' });
  });

  it('returns empty when nothing was adopted', () => {
    expect(pickChangedOfferIdById({ adoptions: [], offerIdById: {} })).toEqual(
      {}
    );
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

  it('unions condition-only refreshes with price changes', () => {
    expect(
      pickChangedConditionById({
        changes: [{ id: 'a' }],
        conditionChanges: [{ id: 'b' }],
        conditionById: { a: 'refurbished', b: 'open_box', c: 'used' },
      })
    ).toEqual({ a: 'refurbished', b: 'open_box' });
  });
});
