import {
  accountIdentitySchema,
  coreObservationSchema,
} from './core-read-observation';

const DIGEST = `sha256:${'d'.repeat(64)}`;

describe('core read observation schemas', () => {
  it('parses the closed normalized identity tuple', () => {
    const identity = {
      domain: 'merchant.example.com',
      vendorId: 'vendor-123',
      currency: 'NGN',
    };

    expect(accountIdentitySchema.parse(identity)).toEqual(identity);
  });

  it('rejects uppercase codes absent from the current official ISO 4217 list', () => {
    expect(
      accountIdentitySchema.safeParse({
        domain: 'merchant.example.com',
        vendorId: 'vendor-123',
        currency: 'ZZZ',
      }).success
    ).toBe(false);
  });

  it('rejects identity fields and unknown keys in persisted evidence', () => {
    const evidence = {
      contractVersion: 1,
      capturedAt: '2026-09-08T12:00:00.000Z',
      publicContractDigest: DIGEST,
      manifestDigest: DIGEST,
      status: 'not_observed',
      blockerCode: 'provider_response_schema_unproven',
      capabilities: {
        accountRead: 'unproven',
        categoryRead: 'unproven',
        menuRead: 'unproven',
        itemRead: 'unproven',
      },
      latencyBucket: 'unavailable',
      byteBucket: 'unavailable',
      rateLimitBucket: 'unavailable',
      limitBucket: 'unavailable',
      vendorId: 'vendor-123',
    };

    expect(coreObservationSchema.safeParse(evidence).success).toBe(false);
  });
});
