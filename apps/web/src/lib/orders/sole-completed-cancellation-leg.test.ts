import { describe, expect, it } from 'vitest';
import { soleCompletedCancellationLeg } from './sole-completed-cancellation-leg';

function leg(overrides: Record<string, unknown> = {}) {
  return {
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: 'ref-1',
    id: 'payment-1',
    status: 'completed',
    ...overrides,
  } as never;
}

describe('soleCompletedCancellationLeg', () => {
  it('returns the only completed funded leg', () => {
    expect(soleCompletedCancellationLeg([leg({})])?.id).toBe('payment-1');
  });
  it('returns null when no completed funded leg exists', () => {
    expect(
      soleCompletedCancellationLeg([
        leg({ status: 'refund_pending' }),
        leg({ amount: 0, id: 'payment-2' }),
      ])
    ).toBeNull();
  });
  it('returns null when two completed funded legs exist', () => {
    expect(
      soleCompletedCancellationLeg([leg({}), leg({ id: 'payment-2' })])
    ).toBeNull();
  });
});
