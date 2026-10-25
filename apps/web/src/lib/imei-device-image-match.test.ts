import { getImeiDeviceProfile } from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import { matchImeiCatalogImage } from './imei-device-image-match';

const products = [
  {
    id: 'p1',
    name: 'iPhone 17 Pro Max',
    brand: 'Apple',
    images: ['https://cdn.example.com/orange.jpg'],
    variants: [
      {
        attributes: { color: 'Cosmic Orange', storage: '512GB' },
        images: ['https://cdn.example.com/orange.jpg'],
      },
      {
        attributes: { color: 'Silver', storage: '512GB' },
        images: ['https://cdn.example.com/silver.jpg'],
      },
    ],
  },
];
describe('catalog device illustrations', () => {
  it('uses the matching colour rather than the first product image', () => {
    expect(
      matchImeiCatalogImage(
        getImeiDeviceProfile({ device: 'iPhone 17 Pro Max 512GB Silver' }),
        products
      )
    ).toMatchObject({
      imageUrl: 'https://cdn.example.com/silver.jpg',
      productId: 'p1',
      match: 'color',
    });
  });
  it('does not substitute a Pro, another generation or a wrong colour', () => {
    for (const device of [
      'iPhone 17 Pro 512GB Silver',
      'iPhone 16 Pro Max Silver',
      'iPhone 17 Pro Max Black',
    ]) {
      expect(
        matchImeiCatalogImage(getImeiDeviceProfile({ device }), products)
      ).toBeNull();
    }
  });
  it('uses a model illustration only when colour is not known', () => {
    expect(
      matchImeiCatalogImage(
        getImeiDeviceProfile({ device: 'iPhone 17 Pro Max' }),
        products
      )?.match
    ).toBe('model');
  });
  it('rejects unsafe image URLs', () => {
    expect(
      matchImeiCatalogImage(
        getImeiDeviceProfile({ device: 'iPhone 17 Pro Max' }),
        [{ ...products[0], images: ['javascript:alert(1)'], variants: [] }]
      )
    ).toBeNull();
  });
});

it.each([
  'iPhone 17 Pro Max Case',
  'iPhone 17 Pro Max Screen Protector',
  'iPhone 17 Pro Max Silicone Case Silver',
])('rejects an accessory before the actual device: %s', (name) => {
  const accessory = { ...products[0], id: 'accessory', name };
  for (const device of [
    'iPhone 17 Pro Max',
    'iPhone 17 Pro Max 512GB Silver',
  ]) {
    expect(
      matchImeiCatalogImage(getImeiDeviceProfile({ device }), [
        accessory,
        ...products,
      ])?.productId
    ).toBe('p1');
    expect(
      matchImeiCatalogImage(getImeiDeviceProfile({ device }), [accessory])
    ).toBeNull();
  }
});
it('accepts only model, manufacturer, storage and colour configuration tokens', () => {
  expect(
    matchImeiCatalogImage(
      getImeiDeviceProfile({ device: 'iPhone 17 Pro Max 512GB Silver' }),
      [{ ...products[0], name: 'Apple iPhone 17 Pro Max 512GB Silver' }]
    )?.productId
  ).toBe('p1');
});
