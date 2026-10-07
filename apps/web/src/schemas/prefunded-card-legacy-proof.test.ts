import { describe, expect, it } from 'vitest';
import { prefundedCardLegacyProofSchemas as schemas } from './prefunded-card-legacy-proof';

const projection = {
  integrationId: '10000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000002',
  customerId: '10000000-0000-4000-8000-000000000003',
  goalId: '10000000-0000-4000-8000-000000000004',
  contributionId: '10000000-0000-4000-8000-000000000005',
  providerTransactionId: 'legacy-transaction',
  eventDataId: 'event-data',
  eventId: 'event',
  providerWalletId: 'wallet',
  providerCustomerId: 'customer',
  amountKobo: 10000,
  feeKobo: 0,
  reference: 'reference',
  sessionId: null,
  creditedAt: '2026-09-25T12:00:00Z',
};

describe('legacy migration proof schemas', () => {
  it('accepts a complete positive-kobo legacy projection', () => {
    expect(schemas.legacy.parse(projection)).toEqual(projection);
  });
  it.each([
    { amountKobo: 0 },
    { amountKobo: 0.5 },
    { feeKobo: 1 },
    { contributionId: '' },
    { creditedAt: '' },
    { unknown: true },
  ])('rejects malformed or unsupported legacy fields: %j', (change) => {
    expect(schemas.legacy.safeParse({ ...projection, ...change }).success).toBe(
      false
    );
  });
  it('requires the exact receipt UUID and lowercase SHA-256, not a signature substitute', () => {
    expect(
      schemas.receiptIdentity.safeParse({
        receiptId: projection.goalId,
        payloadSha256: 'a'.repeat(64),
      }).success
    ).toBe(true);
    expect(
      schemas.receiptIdentity.safeParse({
        receiptId: projection.goalId,
        payloadSha256: 'f'.repeat(128),
      }).success
    ).toBe(false);
  });
});
