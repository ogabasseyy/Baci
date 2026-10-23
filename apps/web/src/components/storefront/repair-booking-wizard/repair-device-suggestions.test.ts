import { describe, expect, it } from 'vitest';
import { toStoreProductSuggestion } from './repair-device-suggestions';

describe('repair device product suggestions', () => {
  it('maps supported phone catalog entries and filters accessories', () => {
    const suggestion = toStoreProductSuggestion({
      id: 'product-1',
      name: 'iPhone 15',
      brand: 'Apple',
      category: 'Phones',
      image: 'https://cdn.example.com/iphone.jpg',
    });

    expect(suggestion).toMatchObject({
      kind: 'store-product',
      displayName: 'Apple iPhone 15',
      deviceType: 'Smartphone',
    });
    expect(
      toStoreProductSuggestion({
        id: 'accessory-1',
        name: 'Phone case',
        category: 'Phone Accessories',
      })
    ).toBeNull();
  });

  it('rejects specific phone accessory categories before phone matching', () => {
    for (const category of [
      'Phone Cases',
      'Phone Chargers',
      'Phone Accessory',
      'Phone Accessories',
      'Mobile Screen Protector',
    ]) {
      expect(
        toStoreProductSuggestion({
          id: category,
          name: 'iPhone accessory',
          category,
        })
      ).toBeNull();
    }
  });
});
