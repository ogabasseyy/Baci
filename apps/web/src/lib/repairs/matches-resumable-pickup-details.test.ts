import { describe, expect, it } from 'vitest';
import { matchesResumablePickupDetails } from './matches-resumable-pickup-details';

describe('matchesResumablePickupDetails', () => {
  const saved = {
    customer_phone: '+2348012345678',
    device_model: 'iPhone 15',
    device_type: 'Smartphone',
    pickup_address: '12 Station Road, Osogbo',
  };

  it('accepts matching pickup details including local Nigerian phone forms', () => {
    expect(
      matchesResumablePickupDetails({
        input: {
          customerPhone: '08012345678',
          deviceModel: 'iPhone 15',
          deviceType: 'Smartphone',
          pickupAddress: '12 Station Road, Osogbo',
        },
        saved,
      })
    ).toBe(true);
  });

  it('rejects resume when the pickup address changed', () => {
    expect(
      matchesResumablePickupDetails({
        input: {
          customerPhone: '+2348012345678',
          deviceModel: 'iPhone 15',
          deviceType: 'Smartphone',
          pickupAddress: '99 Different Street, Lagos',
        },
        saved,
      })
    ).toBe(false);
  });

  it('rejects resume when the device changed', () => {
    expect(
      matchesResumablePickupDetails({
        input: {
          customerPhone: '+2348012345678',
          deviceModel: 'Pixel 9',
          deviceType: 'Smartphone',
          pickupAddress: '12 Station Road, Osogbo',
        },
        saved,
      })
    ).toBe(false);
  });
});
