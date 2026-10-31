import { describe, expect, it } from 'vitest';
import { primaryOwnerFamily } from './primary-event-owner';

describe('primaryOwnerFamily', () => {
  it.each([
    ['wallet-transfer.outflow.success', 'custody'],
    ['interest-payout.success', 'interest'],
    ['bank-transfer.inflow.success', 'bank'],
  ])('maps %s to the %s family', (eventType, family) => {
    expect(primaryOwnerFamily(eventType)).toBe(family);
  });

  it.each([
    'restriction-created.success',
    'interest-accrued.success',
    'bank-transfer.outflow.success',
    'something-unknown',
    'toString',
  ])('leaves %s with no primary owner, so legacy processing owns it', (eventType) => {
    expect(primaryOwnerFamily(eventType)).toBeUndefined();
  });
});
