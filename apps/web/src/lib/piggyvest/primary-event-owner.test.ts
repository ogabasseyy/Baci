import { describe, expect, it } from 'vitest';
import {
  authorizesLegacyHandling,
  primaryOwnerFamily,
} from './primary-event-owner';

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

describe('authorizesLegacyHandling', () => {
  it('lets the legacy family handle any event type', () => {
    expect(
      authorizesLegacyHandling('bank-transfer.inflow.success', ['legacy'])
    ).toBe(true);
  });

  it('also lets the interest family record interest-accrued (no ledger write)', () => {
    expect(
      authorizesLegacyHandling('interest-accrued.success', ['interest'])
    ).toBe(true);
  });

  it.each([
    ['interest-accrued.success', ['bank']],
    ['interest-accrued.success', ['custody']],
    ['bank-transfer.inflow.success', ['interest']],
    ['wallet-transfer.outflow.success', ['bank', 'custody']],
  ] as const)('does not let %s through for %j', (eventType, families) => {
    expect(authorizesLegacyHandling(eventType, families)).toBe(false);
  });
});
