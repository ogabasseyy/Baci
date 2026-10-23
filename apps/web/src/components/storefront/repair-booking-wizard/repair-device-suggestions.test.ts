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

  it('maps console and wearable catalog categories to repair device types', () => {
    for (const category of ['Console', 'Consoles', 'Game Consoles']) {
      expect(
        toStoreProductSuggestion({
          id: category,
          name: 'PlayStation 5',
          category,
        })
      ).toMatchObject({ deviceType: 'Console' });
    }

    expect(
      toStoreProductSuggestion({
        id: 'gaming-console',
        name: 'PlayStation 5',
        category: 'Gaming',
      })
    ).toMatchObject({ deviceType: 'Console' });
    for (const name of [
      'DualSense Wireless Controller',
      'Gaming Headset',
      'FIFA 25 Game',
    ]) {
      expect(
        toStoreProductSuggestion({
          id: name,
          name,
          category: 'Gaming',
        })
      ).toBeNull();
    }

    for (const category of ['Wearable', 'Wearables']) {
      expect(
        toStoreProductSuggestion({
          id: category,
          name: 'Apple Watch Series 10',
          category,
        })
      ).toMatchObject({ deviceType: 'Smartwatch' });
    }
  });

  it('recognizes a device in a secondary product category', () => {
    expect(
      toStoreProductSuggestion({
        id: 'product-secondary-category',
        name: 'Galaxy S24',
        brand: 'Samsung',
        category: 'Featured',
        category_names: ['Featured', 'Smartphones'],
      })
    ).toMatchObject({
      kind: 'store-product',
      displayName: 'Samsung Galaxy S24',
      deviceType: 'Smartphone',
    });
  });

  it('disambiguates combined phone and tablet categories from the product name', () => {
    const categories = ['Phones & Tablets'];
    expect(
      toStoreProductSuggestion({
        id: 'ipad',
        name: 'Apple iPad Pro 11-inch',
        category_names: categories,
      })
    ).toMatchObject({ deviceType: 'Tablet' });
    expect(
      toStoreProductSuggestion({
        id: 'phone',
        name: 'Samsung Galaxy S24',
        category_names: categories,
      })
    ).toMatchObject({ deviceType: 'Smartphone' });
    expect(
      toStoreProductSuggestion({
        id: 'unknown',
        name: 'Device Model',
        category_names: categories,
      })
    ).toBeNull();
  });
});
