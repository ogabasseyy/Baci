import { describe, expect, it, vi } from 'vitest';
import {
  getOrderGiglAddressSignature,
  invalidateOrderGiglFundingQueries,
  isOrderGiglQuoteFresh,
  toCompleteOrderGiglReceiver,
  toOrderGiglAddressDraft,
} from './order-gigl-shipping-state';

const quote = {
  id: 'b2152ea0-831d-4387-b4c1-5dcf29a74c54',
  provider: 'GIGL' as const,
  serviceTier: 'Express',
  carrierName: 'GIG Logistics',
  displayName: 'Door Delivery',
  estimatedDays: 2,
  price: 11000,
  currency: 'NGN' as const,
  pickupIncluded: true,
  insuranceIncluded: false,
  expiresAt: '2026-09-01T18:00:00.000Z',
};

describe('order GIG shipping state', () => {
  it('changes the address signature when only Google coordinates change', () => {
    const first = getOrderGiglAddressSignature({
      address: '1 Allen Avenue',
      latitude: 6.601,
      longitude: 3.351,
      phone: '0801',
    });
    const second = getOrderGiglAddressSignature({
      address: '1 Allen Avenue',
      latitude: 6.602,
      longitude: 3.352,
      phone: '0801',
    });
    expect(second).not.toBe(first);
  });

  it('treats quotes inside the submit safety window as stale', () => {
    expect(
      isOrderGiglQuoteFresh(quote, Date.parse('2026-09-01T17:59:29Z'))
    ).toBe(true);
    expect(
      isOrderGiglQuoteFresh(quote, Date.parse('2026-09-01T17:59:30Z'))
    ).toBe(false);
  });

  it('never invents missing address fields', () => {
    const draft = toOrderGiglAddressDraft({
      address: '1 Allen',
      phone: '0801',
    });
    expect(draft).toEqual({ address: '1 Allen', phone: '0801' });
    expect(toCompleteOrderGiglReceiver(draft)).toBeUndefined();
  });

  it('accepts a coordinate-only Google address and forwards its paired coordinates', () => {
    const draft = toOrderGiglAddressDraft({
      address: 'Google place',
      phone: '0801',
      latitude: 6.6018,
      longitude: 3.3515,
    });

    expect(draft).toEqual({
      address: 'Google place',
      phone: '0801',
      latitude: 6.6018,
      longitude: 3.3515,
    });
    expect(toCompleteOrderGiglReceiver(draft)).toEqual(draft);
  });

  it('rejects incomplete or non-finite coordinate pairs', () => {
    expect(
      toCompleteOrderGiglReceiver({
        address: 'Google place',
        phone: '0801',
        latitude: 6.6018,
      })
    ).toBeUndefined();
    expect(
      toCompleteOrderGiglReceiver({
        address: 'Google place',
        phone: '0801',
        latitude: 91,
        longitude: 3.3515,
      })
    ).toBeUndefined();
  });

  it('invalidates every order and wallet view after observed funding', () => {
    const invalidateQueries = vi.fn();
    invalidateOrderGiglFundingQueries(
      { invalidateQueries } as never,
      'order-1'
    );
    expect(invalidateQueries).toHaveBeenLastCalledWith({
      queryKey: ['merchant-wallet'],
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(5);
  });
});
