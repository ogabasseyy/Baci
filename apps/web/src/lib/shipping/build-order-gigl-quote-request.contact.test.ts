import { describe, expect, it } from 'vitest';
import { buildOrderGiglQuoteRequest } from './build-order-gigl-quote-request';

const sender = {
  name: 'Store',
  phone: '0800',
  address: 'Origin',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

const orderItems = [
  { name: 'iPhone 15', quantity: 1, price: 500000, product_id: 'p1' },
];

describe('buildOrderGiglQuoteRequest contact fallback', () => {
  it('falls back to customer contact when shipping_address name or phone is blank whitespace', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        id: 'o1',
        customer_name: 'Ada',
        customer_phone: '08000000000',
        shipping_address: {
          name: '   ',
          phone: ' ',
          address: '12 Test Street',
          city: 'Ikeja',
          state: 'Lagos',
        },
        order_items: orderItems,
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        receiver: {
          name: 'Ada',
          phone: '08000000000',
        },
      },
    });
  });

  it('prefers shipping_address name and phone over customer fields when both are present', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        id: 'o1',
        customer_name: 'Other Person',
        customer_phone: '09099999999',
        shipping_address: {
          name: 'Ada',
          phone: '08000000000',
          address: '12 Test Street',
          city: 'Ikeja',
          state: 'Lagos',
        },
        order_items: orderItems,
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        receiver: {
          name: 'Ada',
          phone: '08000000000',
        },
      },
    });
  });
});
