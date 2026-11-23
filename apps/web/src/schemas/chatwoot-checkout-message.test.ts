import { describe, expect, it } from 'vitest';
import { chatwootCommerceMessageSchema } from './chatwoot-commerce-message';

const placeData = {
  requestId: 'place-request-1',
  conversationId: 905,
  sessionToken: 'signed-session-capability',
  cartVersion: 8,
  customer: {
    firstName: 'Ada',
    lastName: 'Obi',
    email: 'ada@example.com',
    phone: '+2348012345678',
  },
  address: { line1: '12 Admiralty Way', city: 'Lekki', state: 'Lagos' },
  delivery: {
    displayName: 'Standard delivery',
    priceMajor: 2500,
    pickup: false,
  },
};
const place = (data: unknown) =>
  chatwootCommerceMessageSchema.safeParse({
    event: 'baci-checkout-place-request',
    data,
  });

const statusData = {
  requestId: 'status-request-1',
  conversationId: 905,
  sessionToken: 'signed-session-capability',
  reference: 'ref_abc-123.XYZ',
};
const status = (data: unknown) =>
  chatwootCommerceMessageSchema.safeParse({
    event: 'baci-checkout-payment-status-request',
    data,
  });

describe('baci-checkout-place-request schema', () => {
  it('accepts a complete place request', () => {
    expect(place(placeData).success).toBe(true);
  });

  it('accepts omitted and supported paymentMethod values and rejects unsupported ones', () => {
    expect(place({ ...placeData, paymentMethod: undefined }).success).toBe(
      true
    );
    expect(
      place({ ...placeData, paymentMethod: 'bank_transfer' }).success
    ).toBe(true);
    expect(place({ ...placeData, paymentMethod: 'oxygen' }).success).toBe(true);
    expect(place({ ...placeData, paymentMethod: 'crypto' }).success).toBe(
      false
    );
  });

  it('accepts a pickup choice at a zero price', () => {
    expect(
      place({
        ...placeData,
        delivery: { displayName: 'Ikeja pickup', priceMajor: 0, pickup: true },
      }).success
    ).toBe(true);
  });

  it('rejects unknown keys at every level', () => {
    expect(place({ ...placeData, merchantId: 'caller-selected' }).success).toBe(
      false
    );
    expect(
      place({ ...placeData, customer: { ...placeData.customer, id: 'x' } })
        .success
    ).toBe(false);
    expect(
      place({ ...placeData, address: { ...placeData.address, line2: 'x' } })
        .success
    ).toBe(false);
    expect(
      place({
        ...placeData,
        delivery: { ...placeData.delivery, rateId: 'mrate_1' },
      }).success
    ).toBe(false);
  });

  it('rejects short request ids, missing fields and bad cart versions', () => {
    expect(place({ ...placeData, requestId: 'short' }).success).toBe(false);
    expect(place({ ...placeData, cartVersion: 0 }).success).toBe(false);
    expect(place({ ...placeData, cartVersion: 1.5 }).success).toBe(false);
    const { customer: _customer, ...withoutCustomer } = placeData;
    expect(place(withoutCustomer).success).toBe(false);
  });

  it('bounds customer, address and delivery strings and prices', () => {
    expect(
      place({
        ...placeData,
        customer: { ...placeData.customer, email: 'not-an-email' },
      }).success
    ).toBe(false);
    expect(
      place({
        ...placeData,
        customer: { ...placeData.customer, firstName: 'a'.repeat(61) },
      }).success
    ).toBe(false);
    expect(
      place({
        ...placeData,
        address: { ...placeData.address, line1: 'a'.repeat(201) },
      }).success
    ).toBe(false);
    expect(
      place({
        ...placeData,
        delivery: { ...placeData.delivery, displayName: 'a'.repeat(121) },
      }).success
    ).toBe(false);
    expect(
      place({
        ...placeData,
        delivery: { ...placeData.delivery, priceMajor: -1 },
      }).success
    ).toBe(false);
    expect(
      place({
        ...placeData,
        delivery: { ...placeData.delivery, priceMajor: Number.NaN },
      }).success
    ).toBe(false);
    expect(
      place({ ...placeData, delivery: { ...placeData.delivery, pickup: 'no' } })
        .success
    ).toBe(false);
  });
});

describe('baci-checkout-place-request pickup location', () => {
  const withLocation = (pickupLocation: unknown) =>
    place({
      ...placeData,
      delivery: {
        displayName: 'Collect',
        priceMajor: 0,
        pickup: true,
        pickupLocation,
      },
    });

  it('accepts an optional bounded pickup location', () => {
    expect(withLocation('Ikeja Shop · 1 Allen Avenue').success).toBe(true);
    expect(withLocation('a'.repeat(240)).success).toBe(true);
  });

  it('rejects an empty, oversized or non-string pickup location', () => {
    expect(withLocation('').success).toBe(false);
    expect(withLocation('a'.repeat(241)).success).toBe(false);
    expect(withLocation(5).success).toBe(false);
  });
});

describe('baci-checkout-payment-status-request schema', () => {
  it('accepts a bounded payment reference', () => {
    expect(status(statusData).success).toBe(true);
  });

  it('rejects unsafe or oversized references and extra keys', () => {
    expect(status({ ...statusData, reference: '' }).success).toBe(false);
    expect(status({ ...statusData, reference: 'a b' }).success).toBe(false);
    expect(status({ ...statusData, reference: 'a&gateway=x' }).success).toBe(
      false
    );
    expect(status({ ...statusData, reference: 'a'.repeat(129) }).success).toBe(
      false
    );
    expect(status({ ...statusData, orderId: 'o1' }).success).toBe(false);
  });
});
