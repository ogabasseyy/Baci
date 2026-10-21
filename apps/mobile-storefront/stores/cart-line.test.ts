import {
  createCartLineId,
  isSameCartLine,
  mergeExistingCartItem,
} from './cart-line';
import type { CartItem } from './cart-store.types';

describe('cart-line helpers', () => {
  const baseItem: CartItem = {
    id: 'line-1',
    product_id: 'product-1',
    slug: 'redmi-note-14',
    variant_id: 'variant-128',
    name: 'Redmi Note 14',
    price: 220000,
    quantity: 1,
    color: 'Midnight Black',
    storage: '128GB',
    condition: 'New',
  };
  const incomingBaseItem: Omit<CartItem, 'id'> = {
    product_id: baseItem.product_id,
    slug: baseItem.slug,
    variant_id: baseItem.variant_id,
    name: baseItem.name,
    price: baseItem.price,
    quantity: baseItem.quantity,
    color: baseItem.color,
    storage: baseItem.storage,
    condition: baseItem.condition,
  };

  it('creates stable line ids from voucher awards and the sequence', () => {
    expect(
      createCartLineId(
        {
          product_id: 'product-1',
          slug: 'redmi-note-14',
          variant_id: 'variant-128',
          name: 'Redmi Note 14',
          price: 0,
          quantity: 1,
          voucher_award_id: 'award-1',
        },
        3
      )
    ).toBe('product-1::variant-128::award-1::3');
  });

  it('matches voucher cart lines only when voucher identity matches', () => {
    expect(
      isSameCartLine(baseItem, {
        ...incomingBaseItem,
        voucher_token: 'voucher-1',
      })
    ).toBe(false);

    expect(
      isSameCartLine(
        { ...baseItem, voucher_token: 'voucher-1' },
        { ...incomingBaseItem, voucher_token: 'voucher-1' }
      )
    ).toBe(true);
  });

  it('splits cart lines by condition-offer identity', () => {
    const nonVariantBase: CartItem = { ...baseItem, variant_id: undefined };
    const nonVariantIncoming: Omit<CartItem, 'id'> = {
      ...incomingBaseItem,
      variant_id: undefined,
    };
    expect(
      isSameCartLine(
        { ...nonVariantBase, offer_id: 'offer-7' },
        { ...nonVariantIncoming, offer_id: 'offer-8' }
      )
    ).toBe(false);
    expect(
      isSameCartLine(
        { ...nonVariantBase, offer_id: 'offer-7' },
        { ...nonVariantIncoming, offer_id: 'offer-7' }
      )
    ).toBe(true);
    expect(
      isSameCartLine(
        { ...nonVariantBase, offer_id: 'offer-7' },
        { ...nonVariantIncoming }
      )
    ).toBe(false);
  });

  it('merges existing quantity while preserving negotiated and assurance state', () => {
    expect(
      mergeExistingCartItem(
        {
          ...baseItem,
          quantity: 2,
          max_quantity: 3,
          negotiatedPrice: 190000,
          negotiationStatus: 'accepted',
          hasAssurance: true,
          assuranceRate: 0.05,
        },
        {
          product_id: 'product-1',
          slug: 'redmi-note-14',
          variant_id: 'variant-128',
          name: 'Redmi Note 14 refreshed',
          price: 210000,
          quantity: 2,
          max_quantity: 3,
        },
        { smartCartProEnabled: true, merchantSlug: 'ogabassey' }
      )
    ).toMatchObject({
      id: 'line-1',
      name: 'Redmi Note 14 refreshed',
      quantity: 3,
      negotiatedPrice: 190000,
      negotiationStatus: 'accepted',
      hasAssurance: true,
      assuranceRate: 0.05,
    });
  });

  it('forces voucher merges to opt out without an explicit choice', () => {
    expect(
      mergeExistingCartItem(
        { ...baseItem, voucher_award_id: 'award-1', hasAssurance: true },
        { ...incomingBaseItem, voucher_award_id: 'award-1' },
        { smartCartProEnabled: true, merchantSlug: 'ogabassey' }
      )
    ).toMatchObject({ quantity: 1, hasAssurance: false });
    expect(
      mergeExistingCartItem(
        { ...baseItem, voucher_award_id: 'award-1', hasAssurance: true },
        {
          ...incomingBaseItem,
          voucher_award_id: 'award-1',
          hasAssurance: true,
        },
        { smartCartProEnabled: true, merchantSlug: 'ogabassey' }
      )
    ).toMatchObject({ quantity: 1, hasAssurance: true });
  });

  it('preserves stored attributes when a wildcard-matched add omits them', () => {
    const incoming: Omit<CartItem, 'id'> = {
      ...incomingBaseItem,
      color: undefined,
      storage: undefined,
      condition: undefined,
    };
    expect(isSameCartLine(baseItem, incoming)).toBe(true);
    expect(
      mergeExistingCartItem(baseItem, incoming, {
        smartCartProEnabled: false,
        merchantSlug: 'ogabassey',
      })
    ).toMatchObject({
      quantity: 2,
      color: 'Midnight Black',
      storage: '128GB',
      condition: 'New',
    });
  });

  it('matches display and raw-code conditions canonically', () => {
    // The PDP stamps display ("Open Box") at add time; reprice
    // reconciliation stores the raw live code ("open_box"). Both
    // spellings must merge instead of splitting into duplicates.
    const nonVariantBase = {
      ...baseItem,
      variant_id: undefined,
      condition: 'open_box',
    };
    const nonVariantIncoming = {
      ...incomingBaseItem,
      variant_id: undefined,
      condition: 'Open Box',
    };
    expect(isSameCartLine(nonVariantBase, nonVariantIncoming)).toBe(true);
    expect(
      isSameCartLine(nonVariantBase, {
        ...nonVariantIncoming,
        condition: 'Used',
      })
    ).toBe(false);
    // Missing stays missing on exact (non-variant) lines.
    expect(
      isSameCartLine(nonVariantBase, {
        ...nonVariantIncoming,
        condition: undefined,
      })
    ).toBe(false);
    // Variant lines keep the null wildcard with canonical compare.
    expect(
      isSameCartLine(
        { ...baseItem, condition: 'open_box' },
        { ...incomingBaseItem, condition: 'Open Box' }
      )
    ).toBe(true);
    expect(
      isSameCartLine(baseItem, {
        ...incomingBaseItem,
        condition: undefined,
      })
    ).toBe(true);
  });

  it('wildcards a missing color on variant lines where web stays exact', () => {
    // Cross-platform parity pin (mirrored in web
    // hooks/cart/find-merging-cart-line.test.ts): native merges a
    // color-less add into a color-bearing variant line, while web
    // matches the exact cart item id and stays separate. Alignment is
    // a product decision; this pins the current native contract so
    // either side drifting fails loudly.
    expect(
      isSameCartLine(baseItem, { ...incomingBaseItem, color: undefined })
    ).toBe(true);
    expect(
      isSameCartLine(baseItem, { ...incomingBaseItem, color: 'Arctic White' })
    ).toBe(false);
  });
});
