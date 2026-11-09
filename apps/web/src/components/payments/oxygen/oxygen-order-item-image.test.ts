import { expect, it } from 'vitest';
import { oxygenOrderItemImage } from './oxygen-order-item-image';

it('prefers the order image, then product images, then a placeholder', () => {
  const item = {
    id: 'i',
    name: 'Phone',
    quantity: 1,
    price: 100,
    image_url: 'order.jpg',
    products: { images: ['/product.jpg'] },
  };
  expect(oxygenOrderItemImage(item)).toBe('/product.jpg');
  expect(oxygenOrderItemImage({ ...item, image_url: '  /phone.jpg  ' })).toBe(
    '/phone.jpg'
  );
  expect(oxygenOrderItemImage({ ...item, image_url: '  ' })).toBe(
    '/product.jpg'
  );
  expect(oxygenOrderItemImage({ ...item, image_url: null })).toBe(
    '/product.jpg'
  );
  expect(
    oxygenOrderItemImage({
      ...item,
      image_url: null,
      products: { images: [{ url: ' /object.jpg ' }] },
    })
  ).toBe('/object.jpg');
  expect(
    oxygenOrderItemImage({
      ...item,
      image_url: null,
      products: { images: ['', null] },
    })
  ).toBe('/placeholder.png');
});

it('accepts absolute web images and skips malformed paths before the fallback', () => {
  const item = {
    id: 'i',
    name: 'Phone',
    quantity: 1,
    price: 100,
    image_url: 'https://cdn.example.com/a.jpg',
    products: { images: ['/fallback.jpg'] },
  };
  expect(oxygenOrderItemImage(item)).toBe('https://cdn.example.com/a.jpg');
  expect(
    oxygenOrderItemImage({ ...item, image_url: '//evil.example/a.jpg' })
  ).toBe('/fallback.jpg');
  expect(
    oxygenOrderItemImage({
      ...item,
      image_url: 'relative.jpg',
      products: { images: ['other.jpg'] },
    })
  ).toBe('/placeholder.png');
});

it('normalizes product image URLs in array-valued relationships', () => {
  expect(
    oxygenOrderItemImage({
      id: 'i',
      name: 'Phone',
      quantity: 1,
      price: 100,
      image_url: null,
      products: [{ images: ['  /product.jpg  '] }],
    })
  ).toBe('/product.jpg');
});
