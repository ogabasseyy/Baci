import { describe, expect, it } from 'vitest';
import { isManualAllocatableRefundLeg } from './is-manual-allocatable-refund-leg';

describe('isManualAllocatableRefundLeg', () => {
  it.each([
    'store_credit',
    'cash',
    'manual',
    'pay_on_delivery',
  ])('admits the %s internal leg', (gateway) => {
    expect(isManualAllocatableRefundLeg(gateway)).toBe(true);
  });
  it.each([
    'wallet',
    'savings',
    'paystack',
    'paypal',
  ])('rejects the %s leg', (gateway) => {
    expect(isManualAllocatableRefundLeg(gateway)).toBe(false);
  });
  it('rejects missing or blank gateways like the claim gate', () => {
    expect(isManualAllocatableRefundLeg(null)).toBe(false);
    expect(isManualAllocatableRefundLeg('')).toBe(false);
    expect(isManualAllocatableRefundLeg('   ')).toBe(false);
  });
  it('normalizes legacy gateway casing like the claim gate', () => {
    expect(isManualAllocatableRefundLeg(' Cash ')).toBe(true);
    expect(isManualAllocatableRefundLeg(' Wallet ')).toBe(false);
  });
});
