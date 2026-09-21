import { expect, it } from 'vitest';
import { buildBaseItemXml } from './build-base-feed-item';

it('escapes item fields and leaves absent optional identifiers out', () => {
  const xml = buildBaseItemXml({
    id: 'phone',
    title: 'Phone & case',
    description: 'Phone',
    price: 100,
    currency: 'NGN',
    stockCount: 1,
    availability: 'in_stock',
    condition: 'used',
    brandName: 'Brand',
    imageUrl: 'https://example.com/image.jpg',
    url: 'https://example.com/phone',
    additionalImagesXml: '',
    shippingWeight: '',
  });
  expect(xml).toContain('Phone &amp; case');
  expect(xml).not.toContain('<g:gtin>');
  expect(xml).not.toContain('<g:sale_price>');
});
