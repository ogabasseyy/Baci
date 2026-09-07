import { describe, expect, it } from 'vitest';
import { mobileRepairPickupSchema } from './mobile-repair-pickup';

const data = {
  customerName: 'Test Customer',
  customerEmail: 'test@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone',
  deviceModel: 'iPhone',
  issueDescription: 'Broken device screen',
  serviceType: 'pickup',
  pickupAddress: '10 Test Street, Osogbo, Osun',
};
describe('mobileRepairPickupSchema', () => {
  it('accepts quote and paid pickup requests', () => {
    expect(
      mobileRepairPickupSchema.safeParse({ action: 'quote', data }).success
    ).toBe(true);
    expect(
      mobileRepairPickupSchema.safeParse({
        action: 'pay',
        data,
        expectedPickupFee: 3000,
      }).success
    ).toBe(true);
  });
  it('rejects dropoff and a payment without an agreed fee', () => {
    expect(
      mobileRepairPickupSchema.safeParse({
        action: 'quote',
        data: { ...data, serviceType: 'dropoff' },
      }).success
    ).toBe(false);
    expect(
      mobileRepairPickupSchema.safeParse({ action: 'pay', data }).success
    ).toBe(false);
  });
});
