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
});
