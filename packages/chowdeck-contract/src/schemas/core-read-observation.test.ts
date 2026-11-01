import { coreObservationSchema } from './core-read-observation';

const DIGEST = `sha256:${'d'.repeat(64)}`;

describe('core read observation schema', () => {
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
