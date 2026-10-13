import { describe, expect, it } from '@jest/globals';
import { hasOrderSuccessIdentity } from './order-success-identity';

describe('hasOrderSuccessIdentity', () => {
  it('accepts any single success identifier', () => {
    // Arrange & Act & Assert
    expect(hasOrderSuccessIdentity({ orderId: 'order-1' })).toBe(true);
    expect(hasOrderSuccessIdentity({ orderNumber: 'B-1' })).toBe(true);
    expect(hasOrderSuccessIdentity({ reference: 'ref-1' })).toBe(true);
  });

  it('rejects deep links and stale routes with no success identity', () => {
    // Regression: presenting the interstitial without a completed order
    // burns the once-per-session cap for nothing.
    // Arrange & Act & Assert
    expect(hasOrderSuccessIdentity({})).toBe(false);
    expect(
      hasOrderSuccessIdentity({ orderId: '  ', orderNumber: '', reference: '' })
    ).toBe(false);
    expect(hasOrderSuccessIdentity({ orderId: undefined })).toBe(false);
  });
});
