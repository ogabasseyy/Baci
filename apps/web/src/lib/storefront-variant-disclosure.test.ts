import { describe, expect, it } from 'vitest';
import { getProductPriceRange } from './storefront-product-price-seo';
import {
  filterDefaultAdvertisedVariants,
  isRestrictedWifiOnlyVariant,
  resolveDefaultAdvertisedVariantSelection,
} from './storefront-variant-disclosure';

const variants = [
  {
    id: 'wifi',
    attributes: { sim_type: 'Wi-Fi Only' },
    price_override: 600000,
    stock_quantity: 5,
  },
  {
    id: 'cellular',
    attributes: { sim_type: 'Physical + eSIM' },
    price_override: 900000,
    stock_quantity: 5,
  },
];
describe('restricted connectivity defaults', () => {
  it('resolves the same lowest-priced eligible cellular default without mutating explicit variants', () => {
    const selection = resolveDefaultAdvertisedVariantSelection(
      { price: 600000, manage_stock: false, variants },
      { name: 'iPhone 16' }
    );
    expect(selection?.variant.id).toBe('cellular');
    expect(selection?.price).toBe(900000);
    expect(variants).toHaveLength(2);
    expect(
      resolveDefaultAdvertisedVariantSelection(
        { price: 600000, manage_stock: false, variants },
        { name: 'iPad', category: 'Tablets' }
      )?.variant.id
    ).toBe('wifi');
  });
  it('excludes Wi-Fi-only units from general cellular defaults without removing explicit variants', () => {
    expect(
      filterDefaultAdvertisedVariants(variants, { name: 'iPhone 16' }).map(
        (variant) => variant.id
      )
    ).toEqual(['cellular']);
    expect(variants).toHaveLength(2);
    expect(
      isRestrictedWifiOnlyVariant({ attributes: { 'SIM Type': 'Wifi Only' } })
    ).toBe(true);
  });
  it('preserves normal Wi-Fi tablets', () => {
    expect(
      filterDefaultAdvertisedVariants(variants, {
        name: 'iPad',
        category: 'Tablets',
      })
    ).toHaveLength(2);
  });
  it('does not advertise the cheaper restricted phone in the ordinary price range', () => {
    expect(
      getProductPriceRange({
        name: 'iPhone 16',
        has_variants: true,
        price: 600000,
        manage_stock: false,
        variants,
      })
    ).toEqual({ min: 900000, max: 900000, hasRange: false });
  });
});
