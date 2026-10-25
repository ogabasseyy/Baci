import { describe, expect, it } from 'vitest';
import { selectPriceBandOffer } from './price-band-offer';

const base = {
  id: 'phone',
  name: 'iPhone 14',
  price: 370000,
  category: 'Smartphones',
  manage_stock: false,
};
const variants = [
  {
    id: 'wifi',
    price_override: 370000,
    attributes: { storage: '128GB', sim_type: 'Wi-Fi Only' },
    condition: 'used',
    effective_policy: 'off',
    stock_quantity: 0,
  },
  {
    id: 'cell',
    price_override: 456500,
    attributes: { storage: '128GB', sim_type: 'Physical + eSIM' },
    condition: 'used',
    effective_policy: 'off',
    stock_quantity: 0,
  },
];
describe('selectPriceBandOffer', () => {
  it('prices and links the same eligible cellular configuration', () => {
    expect(
      selectPriceBandOffer(
        { ...base, has_variants: true, product_variants: variants },
        'smartphones',
        500000
      )
    ).toMatchObject({
      price: 456500,
      variantId: 'cell',
      condition: 'used',
      availabilityLabel: 'Available to order — confirm fulfillment',
    });
  });
  it('cannot fall back to a restricted or unavailable parent price', () => {
    expect(
      selectPriceBandOffer(
        { ...base, has_variants: true, product_variants: variants.slice(0, 1) },
        'smartphones',
        500000
      )
    ).toBeNull();
    expect(
      selectPriceBandOffer(
        {
          ...base,
          has_variants: true,
          product_variants: [
            { ...variants[1], effective_policy: 'standard', stock_quantity: 0 },
          ],
        },
        'smartphones',
        500000
      )
    ).toBeNull();
  });
  it('keeps tracked positive inventory and excludes the exact under threshold', () => {
    expect(
      selectPriceBandOffer(
        {
          ...base,
          product_variants: [
            { ...variants[1], effective_policy: 'standard', stock_quantity: 2 },
          ],
        },
        'smartphones',
        500000
      )
    ).toMatchObject({ availabilityLabel: 'In stock' });
    expect(
      selectPriceBandOffer({ ...base, price: 500000 }, 'smartphones', 500000)
    ).toBeNull();
  });
  it('treats explicit null tracking as managed for base offer selection and labels', () => {
    expect(
      selectPriceBandOffer(
        { ...base, manage_stock: null, stock_quantity: 0 },
        'smartphones',
        500000
      )
    ).toBeNull();
    expect(
      selectPriceBandOffer(
        { ...base, manage_stock: null, stock_quantity: 2 },
        'smartphones',
        500000
      )
    ).toMatchObject({ availabilityLabel: 'In stock' });
    expect(
      selectPriceBandOffer(
        { ...base, manage_stock: false, stock_quantity: 0 },
        'smartphones',
        500000
      )
    ).toMatchObject({
      availabilityLabel: 'Available to order — confirm fulfillment',
    });
  });

  it('uses factual feature-phone classification, not price or model guesses', () => {
    expect(
      selectPriceBandOffer(
        {
          ...base,
          product_key_specs: [
            { recommended_for: ['voice_calls', 'feature_phone'] },
          ],
        },
        'smartphones',
        500000
      )
    ).toBeNull();
    expect(
      selectPriceBandOffer({ ...base, price: 15000 }, 'smartphones', 500000)
    ).not.toBeNull();
  });
  it('does not classify untracked zero as unavailable or use stale parent configuration claims', () => {
    const result = selectPriceBandOffer(
      { ...base, product_variants: variants },
      'smartphones',
      500000
    );
    expect(result?.name).toContain('128GB');
    expect(result?.name).toContain('Physical + eSIM');
    expect(result?.description).not.toContain('i7');
  });
});
