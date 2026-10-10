import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import { useSavedStore } from './saved-store';

describe('saved-store', () => {
  beforeEach(() => {
    useSavedStore.setState({
      items: [],
      toastState: { show: false, message: '', type: 'add' },
    });
  });

  it('preserves variant selection metadata when saving SKU-matrix products', () => {
    useSavedStore.getState().addItem({
      id: 'iphone-15',
      name: 'iPhone 15',
      slug: 'iphone-15',
      price: 900000,
      image: 'https://example.com/iphone-15.jpg',
      has_variants: true,
      variant_model: 'sku_matrix',
      available_conditions: ['open_box', 'used'],
      has_condition_offers: true,
    });

    const [item] = useSavedStore.getState().items;

    expect(item).toMatchObject({
      product_id: 'iphone-15',
      has_variants: true,
      variant_model: 'sku_matrix',
      available_conditions: ['open_box', 'used'],
      has_condition_offers: true,
    });
  });

  it('preserves the search-match option identity for the saved price basis', () => {
    useSavedStore.getState().addItem({
      id: 'iphone-15',
      name: 'iPhone 15',
      slug: 'iphone-15',
      price: 750000,
      condition: 'Open Box',
      image: 'https://example.com/iphone-15.jpg',
      searchMatch: {
        productId: 'iphone-15',
        total: 1,
        price: 750000,
        variantId: 'variant-blue-128',
        offerId: 'offer-open-box',
        condition: 'open_box',
      },
    });

    const [item] = useSavedStore.getState().items;

    expect(item).toMatchObject({
      product_id: 'iphone-15',
      price: 750000,
      match_variant_id: 'variant-blue-128',
      match_offer_id: 'offer-open-box',
      match_condition: 'open_box',
    });
  });

  it.each([
    'addItem',
    'toggleSaved',
  ] as const)('drops the parent strike-through when %s saves a matched option', (method) => {
    useSavedStore.getState()[method]({
      id: 'iphone-15',
      name: 'iPhone 15',
      slug: 'iphone-15',
      price: 750000,
      compare_at_price: 900000,
      image: 'https://example.com/iphone-15.jpg',
      searchMatch: {
        productId: 'iphone-15',
        total: 1,
        price: 750000,
        variantId: 'variant-blue-128',
      },
    });

    const [item] = useSavedStore.getState().items;

    expect(item.price).toBe(750000);
    expect(item.compare_at_price).toBeUndefined();
  });

  it('keeps the parent strike-through for unmatched saves', () => {
    useSavedStore.getState().addItem({
      id: 'iphone-15',
      name: 'iPhone 15',
      slug: 'iphone-15',
      price: 750000,
      compare_at_price: 900000,
      image: 'https://example.com/iphone-15.jpg',
    });

    const [item] = useSavedStore.getState().items;

    expect(item.compare_at_price).toBe(900000);
  });
});
