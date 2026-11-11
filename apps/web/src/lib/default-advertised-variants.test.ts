import { describe, expect, it } from 'vitest';
import { filterDefaultAdvertisedVariants } from './default-advertised-variants';

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

describe('default-advertised-variants', () => {
  it('excludes Wi-Fi only variants for phones without mutating source array', () => {
    const filtered = filterDefaultAdvertisedVariants(variants, {
      name: 'iPhone 16',
    });
    expect(filtered.map((v) => v.id)).toEqual(['cellular']);
    expect(variants).toHaveLength(2);
  });

  it('preserves Wi-Fi only variants for tablets', () => {
    const filtered = filterDefaultAdvertisedVariants(variants, {
      name: 'iPad',
      category: 'Tablets',
    });
    expect(filtered).toHaveLength(2);
  });

  it('preserves Wi-Fi variants for non-phone accessories', () => {
    const filtered = filterDefaultAdvertisedVariants(variants, {
      name: 'iPhone 15 Case',
      category: 'Accessories',
    });
    expect(filtered).toHaveLength(2);
  });
});
