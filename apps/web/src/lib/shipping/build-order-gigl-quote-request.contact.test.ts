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

describe('bugfix: non-string contact values diverged from the bind_admin_gigl_quote compare', () => {
  const address = {
    address: '12 Test Street',
    city: 'Ikeja',
    state: 'Lagos',
  };

  it('keeps a numeric shipping_address phone instead of replacing it with customer_phone', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        id: 'o1',
        customer_name: 'Ada',
        customer_phone: '09099999999',
        shipping_address: { ...address, name: 'Ada', phone: 8012345678 },
        order_items: orderItems,
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: { receiver: { phone: '8012345678' } },
    });
  });

  it('keeps a numeric shipping_address name instead of replacing it with customer_name', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        id: 'o1',
        customer_name: 'Ada',
        customer_phone: '08000000000',
        shipping_address: { ...address, name: 4242, phone: '08000000000' },
        order_items: orderItems,
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: { receiver: { name: '4242' } },
    });
  });

  it('quotes an order whose only phone is numeric and customer_phone is empty', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        id: 'o1',
        customer_name: 'Ada',
        customer_phone: null,
        shipping_address: { ...address, phone: 8012345678 },
        order_items: orderItems,
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: { receiver: { phone: '8012345678' } },
    });
  });

  it.each([
    ['a boolean', true],
    ['an object', { digits: '08000000000' }],
    ['an array', ['08000000000']],
    ['null', null],
    ['a non-finite number', Number.NaN],
  ])('falls back to customer_phone when the stored phone is %s', async (_label, phone) => {
    const result = await buildOrderGiglQuoteRequest(
      {
        id: 'o1',
        customer_name: 'Ada',
        customer_phone: '09099999999',
        shipping_address: { ...address, phone },
        order_items: orderItems,
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: { receiver: { phone: '09099999999' } },
    });
  });

  it.each([
    ['a trailing newline', '08000000000\n'],
    ['a trailing tab', '08000000000\t'],
    ['a trailing no-break space', '08000000000\u00a0'],
  ])('does not strip %s, because the SQL btrim only removes spaces', async (_label, phone) => {
    const result = await buildOrderGiglQuoteRequest(
      {
        id: 'o1',
        customer_name: 'Ada',
        customer_phone: '09099999999',
        shipping_address: { ...address, name: 'Ada', phone },
        order_items: orderItems,
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: { receiver: { phone } },
    });
  });

  it('still trims surrounding spaces the way the SQL btrim does', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        id: 'o1',
        customer_name: '  Ada  ',
        customer_phone: ' 08000000000 ',
        shipping_address: { ...address, name: '  ', phone: '' },
        order_items: orderItems,
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: { receiver: { name: 'Ada', phone: '08000000000' } },
    });
  });
});
