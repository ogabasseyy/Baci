import { expect, it } from 'vitest';
import {
  imeiCatalogProductsSchema,
  imeiCatalogVariantsSchema,
} from './imei-device-catalog';

it('normalizes missing image and attribute collections from catalog rows', () => {
  expect(
    imeiCatalogProductsSchema.parse([
      { id: 'product-1', name: 'iPhone 17', brand: 'Apple', images: null },
    ])[0].images
  ).toEqual([]);
  expect(
    imeiCatalogVariantsSchema.parse([
      { product_id: 'product-1', attributes: null, images: null },
    ])[0]
  ).toMatchObject({ attributes: {}, images: [] });
});
it('preserves variant photos and colour while rejecting malformed image rows', () => {
  const variant = {
    product_id: 'product-1',
    attributes: { color: 'Silver' },
    images: [{ url: 'https://example.com/silver.jpg' }],
    primary_image: null,
  };
  expect(imeiCatalogVariantsSchema.parse([variant])).toEqual([variant]);
  expect(
    imeiCatalogProductsSchema.safeParse([
      { id: '', name: 'Phone', brand: null, images: [] },
    ]).success
  ).toBe(false);
  expect(
    imeiCatalogVariantsSchema.safeParse([{ ...variant, images: [42] }]).success
  ).toBe(false);
});
