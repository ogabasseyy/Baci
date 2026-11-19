import { describe, expect, it } from 'vitest';
import { resolveDefaultAdvertisedVariantSelection } from './resolve-default-advertised-variant-selection';

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

describe('resolve-default-advertised-variant-selection', () => {
  it('resolves lowest-priced eligible cellular variant for phones', () => {
    const selection = resolveDefaultAdvertisedVariantSelection(
      { price: 600000, manage_stock: false, variants },
      { name: 'iPhone 16' }
    );
    expect(selection?.variant.id).toBe('cellular');
    expect(selection?.price).toBe(900000);
  });

  it('allows cheaper Wi-Fi only variant for tablets', () => {
    const selection = resolveDefaultAdvertisedVariantSelection(
      { price: 600000, manage_stock: false, variants },
      { name: 'iPad Pro', category: 'Tablets' }
    );
    expect(selection?.variant.id).toBe('wifi');
    expect(selection?.price).toBe(600000);
  });
});
