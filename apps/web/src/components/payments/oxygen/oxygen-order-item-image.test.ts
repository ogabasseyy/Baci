import { expect, it } from 'vitest';
import { oxygenOrderItemImage } from './oxygen-order-item-image';

it('prefers the order image, then product images, then a placeholder', () => {
  const item = {
    id: 'i',
    name: 'Phone',
    quantity: 1,
    price: 100,
    image_url: 'order.jpg',
    products: { images: ['product.jpg'] },
  };
  expect(oxygenOrderItemImage(item)).toBe('order.jpg');
  expect(oxygenOrderItemImage({ ...item, image_url: '  /phone.jpg  ' })).toBe(
    '/phone.jpg'
  );
  expect(oxygenOrderItemImage({ ...item, image_url: '  ' })).toBe(
    'product.jpg'
  );
  expect(oxygenOrderItemImage({ ...item, image_url: null })).toBe(
    'product.jpg'
  );
  expect(
    oxygenOrderItemImage({
      ...item,
      image_url: null,
      products: { images: ['', null] },
    })
  ).toBe('/placeholder.png');
});
