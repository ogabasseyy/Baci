import { describe, expect, it } from 'vitest';
import { prefundedCardReversalSchemas as schemas } from './prefunded-card-reversal';

const command = {
  operationId: '10000000-0000-4000-8000-000000000001',
  integrationId: '10000000-0000-4000-8000-000000000002',
  merchantId: '10000000-0000-4000-8000-000000000003',
  customerId: '10000000-0000-4000-8000-000000000004',
  goalId: '10000000-0000-4000-8000-000000000005',
  treasuryBindingId: '10000000-0000-4000-8000-000000000006',
  savedMethodId: '10000000-0000-4000-8000-000000000007',
  eventId: 'delivery-1',
  collectionReference: 'collection-1',
  collectionTransactionId: '18446744073709551615',
  collectionAmountKobo: 5000,
  currency: 'NGN',
  providerStatus: 'reversed',
  domain: 'test',
};

describe('normalized collection reversal evidence', () => {
  it('accepts the full exact provider transaction identifier', () => {
    expect(schemas.command.parse(command)).toEqual(command);
  });
  it.each([
    { collectionTransactionId: '18446744073709551616' },
    { collectionTransactionId: 'invalid' },
    { collectionTransactionId: '01' },
    { collectionTransactionId: 123 },
    { collectionAmountKobo: 0 },
    { collectionAmountKobo: 1.5 },
    { collectionAmountKobo: Number.MAX_SAFE_INTEGER + 1 },
    { domain: 'live' },
    { currency: 'USD' },
    { providerStatus: 'success' },
    { refundAmountKobo: 5000 },
    { eventId: ' ' },
    { eventId: 'a'.repeat(129) },
    { merchantId: 'other' },
    { goalId: null },
    { providerBody: {} },
  ])('refuses invalid or extra economic authority: %j', (change) => {
    expect(schemas.command.safeParse({ ...command, ...change }).success).toBe(
      false
    );
  });
});
