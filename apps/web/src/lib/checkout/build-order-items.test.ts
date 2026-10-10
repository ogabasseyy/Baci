import { describe, expect, it } from 'vitest';
import { buildCheckoutOrderItems } from './build-order-items';

describe('buildCheckoutOrderItems', () => {
  it('preserves selected variant details in the order payload', () => {
    const items = buildCheckoutOrderItems([
      {
        id: 'prod_1',
        name: 'Galaxy S22 Ultra',
        quantity: 1,
        price: 500000,
        negotiatedPrice: 480000,
        variantId: 'variant_256',
        variantAttributes: {
          color: 'Black',
          storage: '256GB',
        },
        hasAssurance: true,
        assuranceRate: 0.05,
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        product_id: 'prod_1',
        price: 480000,
        value: 480000,
        variantId: 'variant_256',
        variantAttributes: {
          color: 'Black',
          storage: '256GB',
        },
        has_assurance: true,
        assurance_fee: 24000,
      }),
    ]);
  });

  it('hydrates color and storage from cart selections when variant attributes are incomplete', () => {
    const items = buildCheckoutOrderItems([
      {
        id: 'prod_2',
        name: 'Samsung Galaxy S22 Ultra',
        quantity: 1,
        price: 500000,
        selectedColor: 'Phantom Black',
        selectedStorage: '128GB',
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        product_id: 'prod_2',
        variantAttributes: {
          color: 'Phantom Black',
          storage: '128GB',
        },
      }),
    ]);
  });

  it('preserves condition on checkout items', () => {
    const items = buildCheckoutOrderItems([
      {
        id: 'prod-1',
        condition: 'open_box',
        name: 'Samsung Galaxy S22 Ultra',
        price: 500000,
        quantity: 1,
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        condition: 'open_box',
        product_id: 'prod-1',
      }),
    ]);
  });

  it('preserves quiz voucher metadata on gift checkout items', () => {
    const items = buildCheckoutOrderItems([
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'iPhone 15 Pro Max',
        price: 2100000,
        quantity: 1,
        quizAwardId: '44444444-4444-4444-8444-444444444444',
        quizVoucherToken: 'signed-token',
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        product_id: '55555555-5555-4555-8555-555555555555',
        price: 0,
        value: 0,
        voucher_award_id: '44444444-4444-4444-8444-444444444444',
        voucher_token: 'signed-token',
      }),
    ]);
  });

  it('omits quiz voucher metadata when only the award id is present', () => {
    const [item] = buildCheckoutOrderItems([
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'iPhone 15 Pro Max',
        price: 2100000,
        quantity: 1,
        quizAwardId: '44444444-4444-4444-8444-444444444444',
      },
    ]);

    expect(item).not.toHaveProperty('voucher_award_id');
    expect(item).not.toHaveProperty('voucher_token');
  });

  it('omits quiz voucher metadata when only the token is present', () => {
    const [item] = buildCheckoutOrderItems([
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'iPhone 15 Pro Max',
        price: 2100000,
        quantity: 1,
        quizVoucherToken: 'signed-token',
      },
    ]);

    expect(item).not.toHaveProperty('voucher_award_id');
    expect(item).not.toHaveProperty('voucher_token');
  });

  it('omits quiz voucher metadata when voucher fields are empty', () => {
    const [item] = buildCheckoutOrderItems([
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'iPhone 15 Pro Max',
        price: 2100000,
        quantity: 1,
        quizAwardId: '',
        quizVoucherToken: '',
      },
    ]);

    expect(item).not.toHaveProperty('voucher_award_id');
    expect(item).not.toHaveProperty('voucher_token');
  });

  it('multiplies assurance_fee by quantity when quantity > 1', () => {
    const items = buildCheckoutOrderItems([
      {
        id: 'prod_1',
        name: 'Galaxy S22 Ultra',
        quantity: 2,
        price: 500000,
        hasAssurance: true,
        assuranceRate: 0.05,
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        product_id: 'prod_1',
        price: 500000,
        value: 1000000,
        quantity: 2,
        has_assurance: true,
        assurance_fee: 50000,
      }),
    ]);
  });

  it('carries the exact condition-offer id into the order payload', () => {
    const items = buildCheckoutOrderItems([
      {
        id: 'prod_1',
        name: 'Galaxy S22 Ultra',
        quantity: 1,
        price: 400000,
        condition: 'used',
        offerId: 'offer-used-b',
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        product_id: 'prod_1',
        condition: 'used',
        offer_id: 'offer-used-b',
      }),
    ]);
  });
});
