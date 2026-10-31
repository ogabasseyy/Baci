import { describe, expect, it } from 'vitest';
import { planOrderGiglAddressSave } from './order-gigl-address-save-plan';

const receiver = {
  address: '1 Allen Avenue',
  city: 'Ikeja',
  phone: '0801',
  state: 'Lagos',
};

const storedAddress = {
  address: '1 Allen Avenue',
  city: 'Ikeja',
  country: 'Nigeria',
  name: 'Ada',
  phone: '0801',
  postalCode: '100001',
  state: 'Lagos',
};

describe('planOrderGiglAddressSave', () => {
  it('needs no save when the receiver already matches the stored address', () => {
    expect(
      planOrderGiglAddressSave(
        { customer_name: 'Ada', shipping_address: storedAddress },
        receiver
      )
    ).toEqual({ kind: 'unchanged' });
  });

  it('ignores whitespace-only differences the bind also trims', () => {
    expect(
      planOrderGiglAddressSave(
        { shipping_address: { ...storedAddress, phone: ' 0801 ' } },
        receiver
      )
    ).toEqual({ kind: 'unchanged' });
  });

  it('saves typed city and state while keeping the other stored fields', () => {
    expect(
      planOrderGiglAddressSave(
        {
          shipping_address: { ...storedAddress, city: '', state: '' },
        },
        receiver
      )
    ).toEqual({
      kind: 'save',
      shippingAddress: storedAddress,
    });
  });

  it('saves the customer phone fallback when the stored delivery phone is blank', () => {
    const plan = planOrderGiglAddressSave(
      {
        customer_phone: '0801',
        shipping_address: { ...storedAddress, phone: '' },
      },
      receiver
    );
    expect(plan).toEqual({
      kind: 'save',
      shippingAddress: { ...storedAddress, phone: '0801' },
    });
  });

  it('sanitizes typed values before saving them', () => {
    const plan = planOrderGiglAddressSave(
      { shipping_address: { ...storedAddress, city: '' } },
      { ...receiver, city: '  <b>Ikeja</b> ' }
    );
    expect(plan).toMatchObject({
      kind: 'save',
      shippingAddress: { city: 'Ikeja' },
    });
  });

  it('adds the customer name the server would otherwise fill in', () => {
    const { name: _name, ...withoutName } = storedAddress;
    expect(
      planOrderGiglAddressSave(
        { customer_name: ' Ada ', shipping_address: withoutName },
        receiver
      )
    ).toEqual({ kind: 'save', shippingAddress: storedAddress });
  });

  it('keeps stored values for receiver fields the panel did not send', () => {
    expect(
      planOrderGiglAddressSave(
        {
          shipping_address: {
            address: '1 Allen Avenue',
            latitude: 6.6,
            longitude: 3.35,
            name: 'Ada',
            phone: '',
          },
        },
        {
          address: '1 Allen Avenue',
          latitude: 6.6,
          longitude: 3.35,
          phone: '0801',
        }
      )
    ).toEqual({
      kind: 'save',
      shippingAddress: {
        address: '1 Allen Avenue',
        latitude: 6.6,
        longitude: 3.35,
        name: 'Ada',
        phone: '0801',
      },
    });
  });

  it('drops a stale map pin when the street changes without new coordinates', () => {
    const plan = planOrderGiglAddressSave(
      {
        shipping_address: {
          ...storedAddress,
          address: '',
          latitude: '6.6',
          longitude: '3.35',
        },
      },
      receiver
    );
    expect(plan).toEqual({ kind: 'save', shippingAddress: storedAddress });
  });

  it('replaces a legacy string address with a complete address object', () => {
    expect(
      planOrderGiglAddressSave(
        { customer_name: 'Ada', shipping_address: '1 Allen Avenue' },
        receiver
      )
    ).toEqual({
      kind: 'save',
      shippingAddress: { ...receiver, name: 'Ada' },
    });
  });

  it.each([
    ['a saved quote', { selected_quote_id: 'quote-1' }],
    [
      'checkout-funded shipping',
      { shipping_funding_source: 'customer_checkout' },
    ],
  ])('never rewrites an order with %s', (_case, lock) => {
    expect(
      planOrderGiglAddressSave(
        { ...lock, shipping_address: { ...storedAddress, city: '' } },
        receiver
      )
    ).toEqual({ kind: 'locked' });
  });
});
