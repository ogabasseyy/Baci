import { describe, expect, it } from 'vitest';
import { piggyvestInterestRoutingAttestationSchema } from './piggyvest-interest-routing-attestation';

const attestation = {
  attestationId: 'owner-record',
  attestedBy: 'owner',
  businessId: 'business-opaque-id',
  globalSplit: '9%/3%',
  expiresAt: '2099-01-01T00:00:00Z',
};

describe('piggyvestInterestRoutingAttestationSchema', () => {
  it('accepts the exact supported global routing attestation', () => {
    expect(
      piggyvestInterestRoutingAttestationSchema.safeParse(attestation).success
    ).toBe(true);
  });

  it.each([
    { globalSplit: '9%' },
    { expiresAt: 'not-a-date' },
    { businessId: '' },
    { extra: true },
  ])('rejects unverified attestation data', (change) => {
    expect(
      piggyvestInterestRoutingAttestationSchema.safeParse({
        ...attestation,
        ...change,
      }).success
    ).toBe(false);
  });
});
