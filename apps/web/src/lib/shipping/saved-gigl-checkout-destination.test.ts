import { describe, expect, it } from 'vitest';
import { resolveSavedGiglCheckoutDestination } from './saved-gigl-checkout-destination';
import type { QuoteRequest } from './types';

const address = {
  address: '2 Buyer Road',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
const order = { shipping_address: address };
const request: QuoteRequest = {
  sessionId: 'session',
  shipmentType: 'domestic',
  receiver: {
    ...address,
    name: 'Buyer',
    phone: '08000000000',
    latitude: 6.5,
    longitude: 3.3,
  },
  items: [{ name: 'Phone', quantity: 1, value: 5000, weight: 1 }],
};
describe('bound saved GIG checkout destination', () => {
  it('carries both saved pins in memory only after normalized destination matching', () => {
    const resolved = resolveSavedGiglCheckoutDestination(
      { shipping_address: { ...address, address: '  2 BUYER Road  ' } },
      request
    );
    expect(resolved.shipping_address).toMatchObject({
      latitude: 6.5,
      longitude: 3.3,
    });
    expect(order.shipping_address).not.toHaveProperty('latitude');
  });
  it('rejects a changed street suffix even when explicit pins still match', () => {
    expect(() =>
      resolveSavedGiglCheckoutDestination(
        {
          shipping_address: {
            ...address,
            latitude: 6.5,
            longitude: 3.3,
            address: '2 Buyer Road, Other building',
          },
        },
        request
      )
    ).toThrow(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });
  it.each([
    {},
    { latitude: 6.5, longitude: 3.3 },
  ])('accepts the benign locality suffix with coordinates %j', (coordinates) => {
    expect(
      resolveSavedGiglCheckoutDestination(
        {
          shipping_address: {
            ...address,
            ...coordinates,
            address: '2 Buyer Road, Ikeja, Lagos',
          },
        },
        request
      ).shipping_address
    ).toMatchObject({ latitude: 6.5, longitude: 3.3 });
  });
  it.each([
    { address: 'Other Road' },
    { address: '2 Buyer Road, Other building' },
    { city: 'Abuja' },
    { city: '', state: '' },
    { countryCode: 'GH' },
    { latitude: 7, longitude: 4 },
    { latitude: 6.5 },
    { latitude: '', longitude: '' },
  ])('rejects changed destination or explicit conflicting/invalid pins %j', (change) => {
    expect(() =>
      resolveSavedGiglCheckoutDestination(
        { shipping_address: { ...address, ...change } },
        request
      )
    ).toThrow(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });
  it.each([
    { latitude: undefined, longitude: undefined },
    { latitude: Number.NaN, longitude: 3 },
    { latitude: 91, longitude: 3 },
  ])('never substitutes a station pin when saved coordinates are missing or invalid %j', (change) => {
    expect(() =>
      resolveSavedGiglCheckoutDestination(order, {
        ...request,
        receiver: { ...request.receiver, ...change },
      })
    ).toThrow(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });
});
