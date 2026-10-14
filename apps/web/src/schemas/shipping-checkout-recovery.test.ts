import { describe, expect, it } from 'vitest';
import {
  shippingCheckoutRecoverySchema,
  shippingRecoveryContextSchema,
} from './shipping-checkout-recovery';

const receiver = {
  address: '12 Test Street',
  city: 'Ikeja',
  state: 'Lagos',
  phone: '08000000000',
  latitude: 0,
  longitude: 0,
};
describe('checkout recovery input', () => {
  it('accepts an explicit zero pin', () => {
    expect(
      shippingCheckoutRecoverySchema.parse({ action: 'preview', receiver })
    ).toEqual({ action: 'preview', receiver });
  });
  it.each([
    { latitude: undefined },
    { longitude: undefined },
    { latitude: 91 },
    { longitude: -181 },
    { latitude: Number.NaN },
    { longitude: '3.3' },
    { address: '' },
  ])('rejects incomplete or invalid destination %j', (change) => {
    expect(
      shippingCheckoutRecoverySchema.safeParse({
        action: 'preview',
        receiver: { ...receiver, ...change },
      }).success
    ).toBe(false);
  });
  it('carries an optional recovery country code', () => {
    expect(
      shippingCheckoutRecoverySchema.parse({
        action: 'preview',
        receiver: { ...receiver, countryCode: 'NG' },
      })
    ).toEqual({
      action: 'preview',
      receiver: { ...receiver, countryCode: 'NG' },
    });
  });
  it('requires a surviving fulfillment quantity on context items', () => {
    const item = {
      name: 'Phone',
      quantity: 2,
      fulfillment_quantity: 1,
      price: 1000,
      product_id: null,
      product: {
        weight_value: 1,
        weight_unit: 'kg',
        dimensions: null,
        commodity_code: null,
      },
    };
    const order = {
      id: '40000000-0000-4000-8000-000000000001',
      merchant_id: '10000000-0000-4000-8000-000000000001',
      customer_name: null,
      customer_email: null,
      customer_phone: null,
      shipping_address: {},
      shipping_fee: 110,
      order_items: [item],
    };
    const context = {
      fingerprint: 'a'.repeat(64),
      order,
      quote_preference: null,
    };
    expect(shippingRecoveryContextSchema.parse(context)).toEqual(context);
    expect(
      shippingRecoveryContextSchema.safeParse({
        ...context,
        order: {
          ...order,
          order_items: [{ ...item, fulfillment_quantity: undefined }],
        },
      }).success
    ).toBe(false);
  });
  it('requires true confirmation and rejects caller-controlled pricing', () => {
    expect(
      shippingCheckoutRecoverySchema.safeParse({
        action: 'confirm',
        previewId: '70000000-0000-4000-8000-000000000001',
        confirmDestination: false,
      }).success
    ).toBe(false);
    expect(
      shippingCheckoutRecoverySchema.safeParse({
        action: 'preview',
        receiver,
        price: 110,
      }).success
    ).toBe(false);
  });
});
