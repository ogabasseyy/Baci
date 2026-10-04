import { describe, expect, it } from 'vitest';
import { FulfillmentPackageSchema } from './shared';

describe('fulfillment package v7 contract', () => {
  it('uses array orderItems and trackingCode', () => {
    expect(
      FulfillmentPackageSchema.safeParse({
        orderItems: ['ITEM-1'],
        trackingCode: 'TRACK-1',
        countryCode: 'NG',
      }).success
    ).toBe(true);
  });
  it('rejects legacy trackingNumber shape', () => {
    expect(
      FulfillmentPackageSchema.safeParse({
        orderItems: 'ITEM-1',
        trackingNumber: 'TRACK-1',
      }).success
    ).toBe(false);
  });
});
