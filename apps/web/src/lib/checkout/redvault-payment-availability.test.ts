import { describe, expect, it } from 'vitest';
import { getRedvaultPaymentAvailability } from './redvault-payment-availability';

describe('REDVAULT payment availability', () => {
  it('does not expose a chargeable option without provider evidence', () => {
    expect(getRedvaultPaymentAvailability()).toEqual({
      available: false,
      reason: 'provider_evidence_unavailable',
    });
  });
});
